import "server-only";

import { koalaApi, koalaRequestNoData } from "./koala";
import type { KoalaResultMeta } from "./types";
import { safeUserSchema } from "./users";

import { z } from "zod";

/**
 * Escrow — `webAPI/PayoutsController.java`, plus the read surface that does not
 * exist yet.
 *
 * ## The paths, checked against the controller
 *
 * koala-admin#6's body names `POST /admin/job-assignments/{id}/release` and
 * `.../refund`, and on those two the controller agrees. What the issue does not
 * mention is that **refund takes a body**:
 *
 * ```java
 * @PostMapping("/admin/job-assignments/{assignmentId}/refund")
 * public ResponseEntity<SuccessResult> refund(@PathVariable UUID assignmentId,
 *                                             @RequestBody @Valid RefundRequestDto request, …)
 * ```
 *
 * `RefundRequestDto` is `{ amount, reason }`, and `amount` is nullable —
 * `@DecimalMin` passes a null through, and `PayoutManager.refundEmployer` then
 * does `amount == null ? payment.getTotalCharged() : amount`. The panel sends
 * **no amount** (see {@link refundEmployer}), which is the whole of this
 * module's answer to "never let the panel invent a figure".
 *
 * Release returns a `PayoutDto`; refund returns a bare `SuccessResult` with no
 * `data` at all, which is why the two functions below have different shapes.
 *
 * ## Idempotency
 *
 * The backend offers **no idempotency key** — no header, no request field, on
 * any of the three money endpoints. What it offers instead is state:
 *
 *  - **release is idempotent by assignment.** `PayoutManager.releaseToWorker`
 *    opens with `if (payoutDao.existsByJobAssignmentId(id)) { … return existing; }`
 *    and logs "request ignored". A second release creates no second payout.
 *  - **refund is not idempotent, but it is guarded.**
 *    `PaymentStateMachine.canRefund` requires `HELD_IN_ESCROW`, and the first
 *    refund transitions the assignment to `REFUNDED`, so the second answers 409
 *    `{payout.not.refundable}`.
 *
 * That makes a double submit *safe*; it does not make it *invisible*, and it
 * relies on the second request actually arriving after the first has committed.
 * `src/server/escrow/operations.ts` therefore stops the second request in the
 * panel rather than trusting either property.
 */

/** `entities/PaymentStatus.java` — the assignment's escrow state. */
export const PAYMENT_STATUSES = [
  "PENDING_COLLECTION",
  "HELD_IN_ESCROW",
  "RELEASED_TO_WORKER",
  "FAILED",
  "REFUNDED",
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** `entities/AssignmentStatus.java`. */
export const ASSIGNMENT_STATUSES = [
  "PENDING_CONFIRMATION",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "REJECTED",
  "CANCELLED",
] as const;

export type AssignmentStatus = (typeof ASSIGNMENT_STATUSES)[number];

/** `entities/PayoutStatus.java`. */
export const PAYOUT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/**
 * A `BigDecimal` on the wire.
 *
 * Accepted as number *or* string and never converted to one here. The panel's
 * only use for it is `formatCurrency`, which takes both; parsing it into a
 * JavaScript float on the way in would be the first step of exactly the
 * "recompute it in the panel" mistake this screen must not make.
 */
const moneySchema = z.union([z.number(), z.string()]);

const nullableMoney = moneySchema.nullish().transform((value) => value ?? null);

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export type Money = z.infer<typeof moneySchema>;

/* -------------------------------------------------------------------------- */
/* The read surface                                                            */
/* -------------------------------------------------------------------------- */

export function escrowSummaryPath(assignmentId: string): string {
  return `/admin/job-assignments/${encodeURIComponent(assignmentId)}`;
}

/**
 * **This contract is provisional, and the screen above it is built to survive
 * its absence.**
 *
 * `GET /admin/job-assignments/{id}` does not exist in koala-backend today. Every
 * `/admin/**` endpoint that does exist is listed in
 * `StaffPermissionAuthorizationManager`, and an unmapped one is *denied*, not
 * 404'd — so this call answers **403** until someone ships it.
 *
 * It is written anyway, and it is written here rather than inlined, because of
 * what the alternative would be. The dispute list gives the panel a
 * `jobAssignmentId` and nothing else: no amount, no payment status, no worker,
 * no employer. `DisputeDto` has never carried them, and `payment.read` /
 * `finance.read` are declared in `StaffPermission` with **no endpoint behind
 * either of them**. A panel that wanted to show an amount today would have to
 * derive one, and deriving money in the client is the one thing koala-admin#6
 * rules out in as many words.
 *
 * So: the panel asks the server, and when the server cannot answer, the panel
 * does not offer the money buttons at all. `escrow-summary.test.ts` pins that.
 * When the endpoint lands, this schema is the only thing that changes.
 *
 * The fields mirror `entities/JobAssignment.java` and the settled
 * `entities/Payment.java` exactly, because they are the two rows the backend
 * itself reads when it moves the money:
 *
 *  - release pays `assignment.getWorkerPayout()` — `PayoutManager:88`
 *  - refund returns `payment.getTotalCharged()` of the latest SUCCEEDED attempt
 *    — `PayoutManager:115` via `PaymentManager.getSettledPaymentFor`
 */
export const escrowSummarySchema = z.object({
  id: z.string(),
  status: z.enum(ASSIGNMENT_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  currency: z
    .string()
    .nullish()
    .transform((value) => value ?? "TRY"),
  /** What a release would pay the worker. Never added up from anything else. */
  workerPayout: nullableMoney,
  commissionAmount: nullableMoney,
  commissionRate: nullableMoney,
  /** The assignment's snapshot. The refund uses the *payment's*, below. */
  totalCharged: nullableMoney,
  workHours: z
    .number()
    .nullish()
    .transform((value) => value ?? null),
  jobTitle: nullableString,
  worker: safeUserSchema.nullish().transform((value) => value ?? null),
  /** `job.creator` — the party a refund goes back to. */
  employer: safeUserSchema.nullish().transform((value) => value ?? null),
  companyName: nullableString,
  /**
   * The latest SUCCEEDED `Payment`, which is the row a refund is computed from.
   * Null when nothing was ever collected — in which case a refund would answer
   * 404 `{payout.no.settled.payment}` and the panel must not offer one.
   */
  settledPayment: z
    .object({
      id: z.string(),
      currency: z
        .string()
        .nullish()
        .transform((value) => value ?? "TRY"),
      totalCharged: nullableMoney,
      workerPayout: nullableMoney,
      commissionAmount: nullableMoney,
      commissionRate: nullableMoney,
      completedAt: nullableString,
    })
    .nullish()
    .transform((value) => value ?? null),
});

export type EscrowSummary = z.infer<typeof escrowSummarySchema>;

export function getEscrowSummary(
  accessToken: string,
  assignmentId: string,
): Promise<EscrowSummary> {
  return koalaApi.get({
    path: escrowSummaryPath(assignmentId),
    schema: escrowSummarySchema,
    accessToken,
    cache: "no-store",
  });
}

/* -------------------------------------------------------------------------- */
/* The two money endpoints                                                     */
/* -------------------------------------------------------------------------- */

export function escrowReleasePath(assignmentId: string): string {
  return `/admin/job-assignments/${encodeURIComponent(assignmentId)}/release`;
}

export function escrowRefundPath(assignmentId: string): string {
  return `/admin/job-assignments/${encodeURIComponent(assignmentId)}/refund`;
}

/** `core/dtos/payout/response/PayoutDto.java`. */
export const payoutSchema = z.object({
  id: z.string(),
  jobAssignmentId: z.string(),
  /** The figure the backend actually paid. Displayed back verbatim. */
  amount: nullableMoney,
  currency: z
    .string()
    .nullish()
    .transform((value) => value ?? "TRY"),
  status: z.enum(PAYOUT_STATUSES),
  failureReason: nullableString,
  completedAt: nullableString,
  createdAt: nullableString,
});

export type Payout = z.infer<typeof payoutSchema>;

/**
 * `POST /admin/job-assignments/{assignmentId}/release` — pay the worker out of
 * escrow.
 *
 * No request body: the amount is `assignment.getWorkerPayout()`, chosen by the
 * backend. The panel could not override it if it wanted to, which is the right
 * way round.
 *
 * Refused with 409 when the assignment is not COMPLETED, when the money is not
 * `HELD_IN_ESCROW`, or when an active dispute exists
 * (`DisputeMessages.BLOCKS_RELEASE`) — the last of which is the deadlock this
 * whole screen exists to break.
 */
export function releaseEscrow(accessToken: string, assignmentId: string): Promise<Payout> {
  return koalaApi.post({
    path: escrowReleasePath(assignmentId),
    schema: payoutSchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * `POST /admin/job-assignments/{assignmentId}/refund` — return the money to the
 * employer.
 *
 * **The body deliberately carries no `amount`.** `RefundRequestDto.amount` is
 * nullable and `PayoutManager.refundEmployer` reads
 * `amount == null ? payment.getTotalCharged() : amount`, so omitting it makes
 * the backend's own settled-payment total the figure that moves. The panel
 * shows that same number in the confirmation because it *read* it, not because
 * it worked it out — and if the two ever disagree, the one that moves is the
 * server's.
 *
 * Partial refunds are therefore not offered here. The backend supports them;
 * koala-admin#6 does not ask for them, `DisputeManager` never uses them
 * (`refundEmployer(assignmentId, null, note)`), and an amount field on this
 * form would be a box in which an operator can typo a real transfer.
 *
 * Answers a bare `SuccessResult`, so there is no `data` to validate — hence
 * `koalaRequestNoData` and a `KoalaResultMeta` return.
 */
export function refundEmployer(
  accessToken: string,
  assignmentId: string,
  reason: string,
): Promise<KoalaResultMeta> {
  return koalaRequestNoData({
    path: escrowRefundPath(assignmentId),
    method: "POST",
    // `RefundRequestDto.reason` is `@Size(max = 512)`.
    body: { reason: reason.slice(0, 512) },
    accessToken,
    cache: "no-store",
  });
}
