import "server-only";

import { koalaApi } from "./koala";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";
import { safeUserSchema } from "./users";

import { z } from "zod";

/**
 * The dispute contract — `webAPI/DisputesController.java`, read from the
 * controller rather than from the issue text.
 *
 * Two things about the real endpoint that the issue body does not say, and that
 * every screen above this module has to be built around:
 *
 *  1. **`GET /admin/disputes` returns only the *active* ones.** The handler is
 *     `disputeService.getPending(pageable)` and `DisputeManager.getPending`
 *     filters on `DisputeManager.ACTIVE = [OPEN, UNDER_REVIEW]`. There is no
 *     `status` query parameter, and a `RESOLVED` dispute is not reachable
 *     through this endpoint at all. So the queue's status filter can only ever
 *     narrow OPEN vs UNDER_REVIEW, and the screen says so rather than offering
 *     a "Resolved" tab that would always be empty.
 *  2. **It is gated by `dispute.resolve`, not by a read permission.**
 *     `@RequiresPermission(StaffPermission.DISPUTE_RESOLVE)` sits on the list
 *     handler too, so there is no read-only view of the queue to give someone.
 *
 * And what `DisputeDto` does *not* carry, which is the single most consequential
 * fact for this screen: **no amount, no payment status, no parties beyond
 * `openedBy`.** The money figures live in `escrow.ts`, behind a read endpoint
 * that does not exist yet — see the comment there. Nothing in this file
 * computes money, and nothing above it may either.
 */

export const DISPUTES_PATH = "/admin/disputes";

/** `entities/DisputeStatus.java`, member for member. */
export const DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED"] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * `DisputeManager.ACTIVE` — the only two the list endpoint can return.
 * Exported so the queue's filter is derived from the backend's rule instead of
 * repeating it.
 */
export const ACTIVE_DISPUTE_STATUSES = [
  "OPEN",
  "UNDER_REVIEW",
] as const satisfies readonly DisputeStatus[];

/** `entities/DisputeResolution.java`, member for member. */
export const DISPUTE_RESOLUTIONS = ["RELEASE_TO_WORKER", "REFUND_EMPLOYER", "DISMISSED"] as const;

export type DisputeResolution = (typeof DISPUTE_RESOLUTIONS)[number];

export function isDisputeResolution(value: unknown): value is DisputeResolution {
  return typeof value === "string" && (DISPUTE_RESOLUTIONS as readonly string[]).includes(value);
}

/**
 * What each resolution *does to the money*, taken from
 * `DisputeManager.resolveDispute`'s switch:
 *
 * ```java
 * case RELEASE_TO_WORKER -> payoutService.releaseToWorker(assignmentId);
 * case REFUND_EMPLOYER   -> payoutService.refundEmployer(assignmentId, null, note);
 * case DISMISSED         -> log.info("… escrow untouched.");
 * ```
 *
 * `movesMoney` is why the resolution form needs the same two-step confirmation
 * as the standalone release and refund buttons: resolving a dispute as
 * `RELEASE_TO_WORKER` *is* a payout, made through a different URL.
 */
export interface DisputeResolutionSpec {
  readonly resolution: DisputeResolution;
  readonly label: string;
  /** True when choosing it moves escrow. `DISMISSED` is the only one that does not. */
  readonly movesMoney: boolean;
  /** Who ends up with the money, or `null` when nobody does. */
  readonly beneficiary: "WORKER" | "EMPLOYER" | null;
  readonly description: string;
}

export const DISPUTE_RESOLUTION_SPECS: readonly DisputeResolutionSpec[] = [
  {
    resolution: "RELEASE_TO_WORKER",
    label: "İşçiye çıkar",
    movesMoney: true,
    beneficiary: "WORKER",
    description:
      "Emanetteki tutar işçiye çıkar. Bu karar, ayrı bir release çağrısı değil, uyuşmazlık çözümünün kendisi tarafından yapılır.",
  },
  {
    resolution: "REFUND_EMPLOYER",
    label: "İşverene iade et",
    movesMoney: true,
    beneficiary: "EMPLOYER",
    description:
      "Tahsil edilen tutarın tamamı işverene iade edilir. Kısmi paylaşım yoktur; backend iade tutarını kendisi belirler.",
  },
  {
    resolution: "DISMISSED",
    label: "Reddet (emanete dokunma)",
    movesMoney: false,
    beneficiary: null,
    description:
      "Uyuşmazlık kapanır, emanetteki paraya dokunulmaz. Kapandığı için release'i bloke etmeyi de bırakır.",
  },
];

export function disputeResolutionSpec(resolution: DisputeResolution): DisputeResolutionSpec {
  const spec = DISPUTE_RESOLUTION_SPECS.find((entry) => entry.resolution === resolution);
  /* v8 ignore next 3 -- unreachable: the parameter type is the list's key set. */
  if (spec === undefined) {
    throw new Error(`Bilinmeyen uyuşmazlık kararı: ${resolution}`);
  }
  return spec;
}

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/**
 * `core/dtos/dispute/response/DisputeDto.java`.
 *
 * `status` and `resolution` are `z.enum` rather than `z.string()` deliberately:
 * an unrecognised resolution on a screen that decides whether money moved would
 * be worse than a loud schema failure at the boundary.
 */
export const disputeSchema = z.object({
  id: z.string(),
  jobAssignmentId: z.string(),
  openedBy: safeUserSchema.nullish().transform((value) => value ?? null),
  status: z.enum(DISPUTE_STATUSES),
  reason: z.string(),
  resolution: z
    .enum(DISPUTE_RESOLUTIONS)
    .nullish()
    .transform((value) => value ?? null),
  resolutionNote: nullableString,
  /** ISO-8601 instant, UTC. */
  resolvedAt: nullableString,
  createdAt: z.string(),
});

export type Dispute = z.infer<typeof disputeSchema>;

/** Staff list contract: `core/dtos/dispute/response/StaffDisputeEvidenceDto.java`. */
export const disputeEvidenceSchema = z.object({
  id: z.string(),
  disputeId: z.string(),
  uploadedBy: safeUserSchema,
  uploaderSide: z.enum(["WORKER", "EMPLOYER"]),
  fileName: z.string(),
  contentType: z.string(),
  fileSize: z.number().int().nonnegative(),
  checksumSha256: z.string(),
  createdAt: z.string(),
});

export type DisputeEvidence = z.infer<typeof disputeEvidenceSchema>;

export interface DisputeQuery {
  /** Zero-based, like `PageDto`. */
  page?: number;
  /** `PageableSanitizer.MAX_PAGE_SIZE` is 100; anything larger is silently clamped. */
  size?: number;
}

/**
 * The queue.
 *
 * No `status` parameter is sent, because the endpoint has none — passing one
 * would be quietly ignored by Spring and would make the screen's filter look
 * server-side when it is not. The caller filters the page it was given and says
 * so on screen.
 */
export function getDisputes(
  accessToken: string,
  query: DisputeQuery = {},
): Promise<PageDto<Dispute>> {
  return koalaApi.get({
    path: DISPUTES_PATH,
    schema: pageDtoSchema(disputeSchema),
    query: { page: query.page ?? 0, size: query.size ?? 50 },
    accessToken,
    cache: "no-store",
  });
}

export function disputeEvidencePath(disputeId: string): string {
  return `${DISPUTES_PATH}/${encodeURIComponent(disputeId)}/evidence`;
}

export function getDisputeEvidence(
  accessToken: string,
  disputeId: string,
): Promise<DisputeEvidence[]> {
  return koalaApi.get({
    path: disputeEvidencePath(disputeId),
    schema: z.array(disputeEvidenceSchema),
    accessToken,
    cache: "no-store",
  });
}

export function disputeResolvePath(disputeId: string): string {
  return `${DISPUTES_PATH}/${encodeURIComponent(disputeId)}/resolve`;
}

export interface ResolveDisputeInput {
  resolution: DisputeResolution;
  /**
   * `ResolveDisputeDto.note` — `@Size(max = 2000)` and, on the backend, *not*
   * `@NotBlank`. The panel requires it anyway: koala-admin#6 asks for a
   * mandatory free-text reason, and a resolution that moved a day's wage with
   * no recorded reason is the thing the audit row exists to prevent. The
   * requirement is enforced in `src/server/escrow/operations.ts`, before this
   * function is reached.
   */
  note: string;
}

/**
 * `POST /admin/disputes/{disputeId}/resolve`.
 *
 * **This call can move money.** `DisputeManager.resolveDispute` marks the
 * dispute resolved and then, in the same transaction, calls
 * `payoutService.releaseToWorker(...)` or `refundEmployer(...)` depending on
 * the resolution. There is no idempotency key: a second call answers 409
 * `{dispute.already.resolved}` because the status has already moved to
 * RESOLVED, which makes a double submit *safe* but not *silent*.
 */
export function resolveDispute(
  accessToken: string,
  disputeId: string,
  input: ResolveDisputeInput,
): Promise<Dispute> {
  return koalaApi.post({
    path: disputeResolvePath(disputeId),
    schema: disputeSchema,
    body: { resolution: input.resolution, note: input.note },
    accessToken,
    cache: "no-store",
  });
}
