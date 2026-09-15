import "server-only";

import type { Permission } from "@/server/authz/permissions";

import { koalaApi } from "./koala";
import { sortParam, type PagingContract, type SortSpec } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
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
 *  1. **`GET /admin/disputes` is pending unless `status` is sent.** Omit the
 *     parameter and `DisputeManager.searchForStaff` returns OPEN +
 *     UNDER_REVIEW. `status=RESOLVED` pages closed records, including those
 *     whose resolution is DISMISSED. There is no `audit.read`; the list stays
 *     on `dispute.resolve`.
 *  2. **It is gated by `dispute.resolve`, not by a read permission.**
 *     `@RequiresPermission(StaffPermission.DISPUTE_RESOLVE)` sits on the list
 *     and the object GET too, so there is no read-only view of the queue.
 *  3. **`GET /admin/disputes/{id}` returns the same DisputeDto.** Amounts are
 *     still on `GET /admin/job-assignments/{id}` (`payment.read`).
 *
 * And what `DisputeDto` does *not* carry, which is the single most consequential
 * fact for this screen: **no amount, no payment status, no parties beyond
 * `openedBy`.** The money figures live in `escrow.ts`, behind
 * `GET /admin/job-assignments/{id}`, which requires `payment.read`. Nothing in
 * this file computes money, and nothing above it may either.
 */

export const DISPUTES_PATH = "/admin/disputes";

/**
 * `DisputeManager.SORTABLE` = `createdAt`, `status`; varsayılan `createdAt,desc`.
 * Panel yalnız `createdAt`i açar (durum zaten süzgeç). Varsayılan boyut 25,
 * emanetteki N+1 özet okumasını sınırlamak için. `sort` yalnız istendiğinde
 * gider; verilmezse backend kendi varsayılanına düşer.
 */
export const DISPUTE_PAGING: PagingContract = {
  sortable: ["createdAt"],
  defaultSort: { field: "createdAt", direction: "desc" },
  defaultSize: 25,
};

/** `entities/DisputeStatus.java`, member for member. */
export const DISPUTE_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED"] as const;

export type DisputeStatus = (typeof DISPUTE_STATUSES)[number];

/**
 * `DisputeManager.ACTIVE` — the statuses returned when `status` is omitted.
 * Home counts this pending queue, not the closed archive.
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
  /** Additional mutating permission the backend requires for this variant. */
  readonly financialPermission: Extract<Permission, "payout.release" | "payment.refund"> | null;
  readonly description: string;
}

export const DISPUTE_RESOLUTION_SPECS: readonly DisputeResolutionSpec[] = [
  {
    resolution: "RELEASE_TO_WORKER",
    label: "İşçiye çıkar",
    movesMoney: true,
    beneficiary: "WORKER",
    financialPermission: "payout.release",
    description:
      "Emanetteki tutar işçiye çıkar. Bu karar, ayrı bir release çağrısı değil, uyuşmazlık çözümünün kendisi tarafından yapılır.",
  },
  {
    resolution: "REFUND_EMPLOYER",
    label: "İşverene iade et",
    movesMoney: true,
    beneficiary: "EMPLOYER",
    financialPermission: "payment.refund",
    description:
      "Tahsil edilen tutarın tamamı işverene iade edilir. Kısmi paylaşım yoktur; backend iade tutarını kendisi belirler.",
  },
  {
    resolution: "DISMISSED",
    label: "Reddet (emanete dokunma)",
    movesMoney: false,
    beneficiary: null,
    financialPermission: null,
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
 * `entities/DisputeSide.java` — açan tarafın atamadaki rolü
 * (koala-backend#283). Yalnız gösterim: şema serbest dize okur, etiket
 * bilinmeyen kodu olduğu gibi yazar. Katılık (`z.enum`) bu dosyada yalnız
 * para kararı taşıyan `status` ve `resolution`'da.
 */
export const DISPUTE_SIDES = ["WORKER", "EMPLOYER"] as const;
export type DisputeSide = (typeof DISPUTE_SIDES)[number];

const DISPUTE_SIDE_LABELS: Readonly<Record<string, string>> = {
  WORKER: "İşçi",
  EMPLOYER: "İşveren",
} satisfies Record<DisputeSide, string>;

export function disputeSideLabel(side: string): string {
  return DISPUTE_SIDE_LABELS[side] ?? side;
}

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
  openedBySide: nullableString,
  status: z.enum(DISPUTE_STATUSES),
  reason: z.string(),
  resolution: z
    .enum(DISPUTE_RESOLUTIONS)
    .nullish()
    .transform((value) => value ?? null),
  resolutionNote: nullableString,
  /** Çözen personel; yalnız personel görünümünde dolu (koala-backend#283). */
  resolvedByStaffId: nullableString,
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
  /**
   * Omit to keep the pending queue. `RESOLVED` includes DISMISSED
   * resolutions; DISMISSED itself is not a list status.
   */
  status?: DisputeStatus | null;
  /** koala-backend#263: uyuşmazlık id'si, atama id'si ve tarafların ad-soyadı/e-postası. */
  query?: string | null;
  /** koala-backend#283: işçi, ilan sahibi ya da açan olarak bu kullanıcının uyuşmazlıkları. */
  userId?: string | null;
  /** koala-backend#301: `createdAt` aralığı, dilimli ISO, iki sınır dahil. */
  from?: string | null;
  to?: string | null;
  /** `DISPUTE_PAGING.sortable` içinden; ev karosu ve `?sirala=` için (koala-admin#111). */
  sort?: SortSpec | null;
}

/**
 * The queue.
 *
 * `status` is omitted for the pending default so Spring does not receive a
 * dummy value. A concrete status is forwarded as a query parameter.
 */
export function getDisputes(
  accessToken: string,
  query: DisputeQuery = {},
): Promise<PageDto<Dispute>> {
  return koalaApi.get({
    path: DISPUTES_PATH,
    schema: pageDtoSchema(disputeSchema),
    query: {
      page: query.page ?? 0,
      size: query.size ?? DISPUTE_PAGING.defaultSize ?? 25,
      ...(query.status ? { status: query.status } : {}),
      query: searchQueryParam(query.query),
      userId: query.userId ?? undefined,
      from: query.from ?? undefined,
      to: query.to ?? undefined,
      sort: query.sort ? sortParam(query.sort) : undefined,
    },
    accessToken,
    cache: "no-store",
  });
}

export function disputeDetailPath(disputeId: string): string {
  return `${DISPUTES_PATH}/${encodeURIComponent(disputeId)}`;
}

/** `GET /admin/disputes/{disputeId}` — same DisputeDto as the queue. Amounts stay on the assignment GET. */
export function getDispute(accessToken: string, disputeId: string): Promise<Dispute> {
  return koalaApi.get({
    path: disputeDetailPath(disputeId),
    schema: disputeSchema,
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
