import "server-only";

import { koalaApi, koalaRequestNoData } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
import { linkedRecordSchema } from "./shared/linked-record";
import { pricingBreakdownSchema } from "./shared/pricing";
import { assignmentTransportSchema } from "./transport";
import type { KoalaResultMeta, PageDto } from "./types";
import { safeUserSchema } from "./users";

import { z } from "zod";

/**
 * Escrow — `webAPI/PayoutsController.java` and `AdminController.assignment`.
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
 * Both requests carry their audit reason. Release returns a `PayoutDto`; refund
 * returns a bare `SuccessResult` with no `data` at all, which is why the two
 * functions below have different shapes.
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
 * A `PayoutDto.amount` `BigDecimal` on the wire.
 *
 * Unlike `PricingBreakdownDto`, which explicitly serialises decimal fields as
 * strings, this older response may carry a JSON number. It is never converted
 * here; `formatCurrency` takes either representation.
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

export const ASSIGNMENTS_PATH = "/admin/job-assignments";

/** `JobAssignmentManager.ADMIN_LIST_SORTABLE` / default `createdAt,desc`. */
export const ASSIGNMENT_PAGING: PagingContract = {
  sortable: ["createdAt", "assignmentDateTime", "status", "paymentStatus"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export function escrowSummaryPath(assignmentId: string): string {
  return `${ASSIGNMENTS_PATH}/${encodeURIComponent(assignmentId)}`;
}

/**
 * `AdminAssignmentDto` from `GET /admin/job-assignments/{id}`.
 *
 * The pricing snapshot deliberately stays under `pricing`. Flattening it into
 * optional fields once hid a backend contract change by turning every real
 * amount into `null`, leaving all financial decisions disabled while the read
 * itself appeared successful.
 */
export const escrowSummarySchema = z.object({
  id: z.string(),
  jobId: z.string(),
  jobTitle: nullableString,
  /**
   * koala-backend#301: şirket kimliği adın yanında; bireysel ilanda ikisi de
   * `null`. Eski sunucu alanı göndermez — `null` kalır, şirket adı düz
   * metin çizilir, sayfa düşmez (koala-admin#105).
   */
  companyId: nullableString,
  companyName: nullableString,
  worker: safeUserSchema,
  employer: safeUserSchema,
  status: z.enum(ASSIGNMENT_STATUSES),
  paymentStatus: z.enum(PAYMENT_STATUSES),
  assignmentDateTime: nullableString,
  actualCompletionDateTime: nullableString,
  workHours: z.number().int(),
  pricing: pricingBreakdownSchema,
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

/*
 * koala-backend#283 zaman çizelgesi sözlükleri. Hepsi yalnız gösterim:
 * şema serbest dize okur, etiket bilinmeyen kodu olduğu gibi yazar. Bu
 * dosyada `z.enum` yalnız para kararı taşıyan `status` / `paymentStatus`ta —
 * bir başvuru durumu yüzünden atama sayfası düşmez.
 */

/** `entities/ApplicationStatus.java`. */
export const APPLICATION_STATUSES = ["APPLIED", "ACCEPTED", "REJECTED", "WITHDRAWN"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

const APPLICATION_STATUS_LABELS: Readonly<Record<string, string>> = {
  APPLIED: "Başvurdu",
  ACCEPTED: "Kabul edildi",
  REJECTED: "Reddedildi",
  WITHDRAWN: "Geri çekildi",
} satisfies Record<ApplicationStatus, string>;

export function applicationStatusLabel(status: string): string {
  return APPLICATION_STATUS_LABELS[status] ?? status;
}

/** `entities/CancellationParty.java`. */
export const CANCELLATION_PARTIES = ["WORKER", "EMPLOYER", "ADMIN"] as const;
export type CancellationParty = (typeof CANCELLATION_PARTIES)[number];

const CANCELLATION_PARTY_LABELS: Readonly<Record<string, string>> = {
  WORKER: "İşçi",
  EMPLOYER: "İşveren",
  ADMIN: "Personel",
} satisfies Record<CancellationParty, string>;

export function cancellationPartyLabel(party: string): string {
  return CANCELLATION_PARTY_LABELS[party] ?? party;
}

/** `entities/JobEmployerType.java`. */
export const ASSIGNMENT_EMPLOYER_TYPES = ["COMPANY", "INDIVIDUAL"] as const;
export type AssignmentEmployerType = (typeof ASSIGNMENT_EMPLOYER_TYPES)[number];

const ASSIGNMENT_EMPLOYER_TYPE_LABELS: Readonly<Record<string, string>> = {
  COMPANY: "Şirket",
  INDIVIDUAL: "Bireysel",
} satisfies Record<AssignmentEmployerType, string>;

export function assignmentEmployerTypeLabel(type: string): string {
  return ASSIGNMENT_EMPLOYER_TYPE_LABELS[type] ?? type;
}

/** `entities/TimesheetPlausibilityFlag.java`. */
export const TIMESHEET_PLAUSIBILITY_FLAG_LABELS: Readonly<Record<string, string>> = {
  DEVICE_TIME_IMPLAUSIBLE: "Cihaz saati şüpheli",
  OUTSIDE_JOB_WINDOW: "İş penceresi dışında",
  NON_MONOTONIC: "Sıra dışı zaman",
};

export function timesheetFlagLabel(flag: string): string {
  return TIMESHEET_PLAUSIBILITY_FLAG_LABELS[flag] ?? flag;
}

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);

/** `BigDecimal` koordinat sayı gelir; panel yalnız yazar, hesaplamaz. */
const nullableDecimal = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => value ?? null);

/** `AdminApplicationDto` — atamayı doğuran başvuru. */
export const adminApplicationSchema = z.object({
  id: z.string(),
  status: nullableString,
  applicationDateTime: nullableString,
  answeredDateTime: nullableString,
  rejectionReason: nullableString,
});

export type AdminApplication = z.infer<typeof adminApplicationSchema>;

/**
 * `WorkSessionDto` — bir giriş/çıkış çifti. Bayraklar backend'in
 * plausibility kararıdır; panel yalnız listeler, kendisi bayrak üretmez.
 */
export const workSessionSchema = z.object({
  id: z.string(),
  checkInAt: nullableString,
  checkOutAt: nullableString,
  checkInCapturedAt: nullableString,
  checkInReceivedAt: nullableString,
  checkInPlausibilityFlags: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  checkOutCapturedAt: nullableString,
  checkOutReceivedAt: nullableString,
  checkOutPlausibilityFlags: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  checkInLatitude: nullableDecimal,
  checkInLongitude: nullableDecimal,
  checkOutLatitude: nullableDecimal,
  checkOutLongitude: nullableDecimal,
  minutes: nullableInt,
  /**
   * koala-backend#352: koordinat kayıtlı ama okuyanın `user.read_pii` izni
   * yok diye `null` döndü. Eski sunucuda alan yok → `false`.
   */
  checkInLocationWithheld: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  checkOutLocationWithheld: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
});

export type WorkSession = z.infer<typeof workSessionSchema>;

/** `AdminCancellationDto`. Para alanları backend metni; `refundId` iade kaydının kimliğidir. */
export const adminCancellationSchema = z.object({
  id: z.string(),
  cancelledByParty: nullableString,
  cancelledBy: safeUserSchema.nullish().transform((value) => value ?? null),
  reason: nullableString,
  noticeMinutes: nullableInt,
  feeRate: nullableString,
  feeAmount: nullableString,
  refundAmount: nullableString,
  refundId: nullableString,
  cancelledAt: nullableString,
});

export type AdminCancellation = z.infer<typeof adminCancellationSchema>;

/** `AdminReviewDto` — taraflar yalnız kimlik; ad atama DTO'sundan eşlenir. */
export const adminReviewSchema = z.object({
  id: z.string(),
  authorId: nullableString,
  subjectId: nullableString,
  rating: nullableInt,
  comment: nullableString,
  anonymous: z
    .boolean()
    .nullish()
    .transform((value) => value ?? false),
  createdAt: nullableString,
});

export type AdminReview = z.infer<typeof adminReviewSchema>;

/**
 * `AdminAssignmentDetailDto` (koala-backend#265) — `AdminAssignmentDto`'nun
 * üst kümesi. Bağlı kayıtlar `LinkedRecordDto`; ödeme denemelerinin gövdesi
 * ayrı uçtan (`getAssignmentPayments`, `payments.ts`) okunur.
 *
 * Eski `escrowSummarySchema` aynı uca karşı çalışmaya devam eder: zod
 * bilinmeyen alanları düşürür, uyuşmazlık sayfası ve emanet kapısı tek bir
 * alan bile değiştirmeden aynı özeti alır.
 *
 * koala-backend#283 zaman çizelgesi alanları isteğe bağlı: #265 sunucusu
 * bunları göndermez ve sayfa o sunucuda da açılmalı — çizelge yalnız elde
 * olan anlardan kurulur, eksik kart çizilmez.
 */
export const assignmentDetailSchema = escrowSummarySchema.extend({
  payments: z.array(linkedRecordSchema).default([]),
  payout: linkedRecordSchema.nullish().transform((value) => value ?? null),
  disputes: z.array(linkedRecordSchema).default([]),
  reports: z.array(linkedRecordSchema).default([]),
  employerType: nullableString,
  expectedCompletionDateTime: nullableString,
  notes: nullableString,
  application: adminApplicationSchema.nullish().transform((value) => value ?? null),
  workSessions: z
    .array(workSessionSchema)
    .nullish()
    .transform((value) => value ?? null),
  cancellation: adminCancellationSchema.nullish().transform((value) => value ?? null),
  reviews: z
    .array(adminReviewSchema)
    .nullish()
    .transform((value) => value ?? null),
  transport: assignmentTransportSchema.nullish().transform((value) => value ?? null),
  createdAt: nullableString,
  updatedAt: nullableString,
});

export type AssignmentDetail = z.infer<typeof assignmentDetailSchema>;

export type { LinkedRecord } from "./shared/linked-record";

export function getAssignmentDetail(
  accessToken: string,
  assignmentId: string,
): Promise<AssignmentDetail> {
  return koalaApi.get({
    path: escrowSummaryPath(assignmentId),
    schema: assignmentDetailSchema,
    accessToken,
    cache: "no-store",
  });
}

export interface AssignmentQueueQuery {
  readonly paging: Paging;
  /**
   * koala-backend#263: atama id'si, ilan başlığı, işveren ve çalışanın
   * ad-soyadı ile e-postasında arar. 2–100 kuralı `searchQueryParam`'da.
   */
  readonly query?: string | null;
  /** koala-backend#283: yalnız bu işçinin atamaları; `query` ile kesişir. */
  readonly workerId?: string | null;
  /** koala-backend#283: yalnız bu işverenin (ilan sahibinin) atamaları. */
  readonly employerId?: string | null;
  /**
   * koala-backend#301: atama durumları; boş/`null` her durum. Virgülle tek
   * parametre gider (`status=A,B`), hakediş listesiyle aynı kalıp.
   */
  readonly status?: readonly AssignmentStatus[] | null;
  /** koala-backend#301: `createdAt` aralığı, dilimli ISO, iki sınır dahil. */
  readonly from?: string | null;
  readonly to?: string | null;
}

export function getAdminAssignments(
  accessToken: string,
  query: AssignmentQueueQuery,
): Promise<PageDto<EscrowSummary>> {
  return koalaApi.get({
    path: ASSIGNMENTS_PATH,
    schema: pageDtoSchema(escrowSummarySchema),
    query: {
      query: searchQueryParam(query.query),
      workerId: query.workerId ?? undefined,
      employerId: query.employerId ?? undefined,
      status:
        query.status === null || query.status === undefined || query.status.length === 0
          ? undefined
          : query.status.join(","),
      from: query.from ?? undefined,
      to: query.to ?? undefined,
      ...pagingQuery(query.paging),
    },
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
 * `ReleaseRequestDto` carries only the audit reason. The amount is
 * `assignment.getWorkerPayout()`, chosen by the backend. The panel could not
 * override it if it wanted to, which is the right way round.
 *
 * Refused with 409 when the assignment is not COMPLETED, when the money is not
 * `HELD_IN_ESCROW`, or when an active dispute exists
 * (`DisputeMessages.BLOCKS_RELEASE`) — the last of which is the deadlock this
 * whole screen exists to break.
 */
export function releaseEscrow(
  accessToken: string,
  assignmentId: string,
  reason: string,
): Promise<Payout> {
  return koalaApi.post({
    path: escrowReleasePath(assignmentId),
    schema: payoutSchema,
    body: { reason },
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
    body: { reason },
    accessToken,
    cache: "no-store",
  });
}
