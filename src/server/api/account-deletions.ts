import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
import type { PageDto } from "./types";

/**
 * Hesap silme kuyruğu — `webAPI/AccountDeletionController`.
 *
 * ```java
 * GET  /admin/account-deletions?status=REQUESTED|ANONYMIZED|REJECTED
 * GET  /admin/account-deletions/{requestId}
 * POST /admin/account-deletions/{requestId}/reject  { reason }
 * ```
 *
 * `status` opsiyonel: verilmezse üç durum birden. Onay ucu yok —
 * anonimleştirme zamanlayıcı işi. Panel yalnız listeler ve reddeder.
 */

export const ACCOUNT_DELETIONS_PATH = "/admin/account-deletions";

/** `LegalManager.DELETION_SORT_FIELDS`, copied. */
export const DELETION_PAGING: PagingContract = {
  sortable: ["id", "subjectId", "status", "requestedAt", "processedAt"],
  defaultSort: { field: "requestedAt", direction: "desc" },
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/**
 * `entities/DeletionBlockerType.java`. Kimlik türe göre başka kayda gider:
 * `PENDING_PAYMENT` ödeme denemesi, `ESCROW`/`ACTIVE_WORK` atama,
 * `DISPUTE` uyuşmazlık (`LegalManager.collectBlockers` → `PartyLink.id`).
 */
export const DELETION_BLOCKER_TYPES = [
  "PENDING_PAYMENT",
  "ESCROW",
  "ACTIVE_WORK",
  "DISPUTE",
] as const;

export type DeletionBlockerType = (typeof DELETION_BLOCKER_TYPES)[number];

export const DELETION_BLOCKER_LABELS: Record<DeletionBlockerType, string> = {
  PENDING_PAYMENT: "Bekleyen tahsilat",
  ESCROW: "Emanette para",
  ACTIVE_WORK: "Devam eden iş",
  DISPUTE: "Açık uyuşmazlık",
};

/** `DeletionBlockerDto` — tür serbest metin: yeni bir engel türü sayfayı düşürmesin. */
export const deletionBlockerSchema = z.object({
  type: z.string(),
  id: nullableString,
});

export type DeletionBlocker = z.infer<typeof deletionBlockerSchema>;

export function deletionBlockerLabel(type: string): string {
  return (DELETION_BLOCKER_LABELS as Readonly<Record<string, string>>)[type] ?? type;
}

/**
 * `core/dtos/legal/response/AccountDeletionDto.java`. koala-backend#283
 * alanları isteğe bağlı: `rejectionReason` ve `rejectedByStaffId` ret
 * kararında yazılır, `blockers` yalnız `REQUESTED` talepte canlı hesaplanır;
 * eski sunucu üçünü de göndermez (`blockers` `null`, bölüm gizli).
 */
export const accountDeletionSchema = z.object({
  id: z.string(),
  subjectId: nullableString,
  status: z.string(),
  requestedAt: nullableString,
  processedAt: nullableString,
  blockedReason: nullableString,
  rejectionReason: nullableString,
  rejectedByStaffId: nullableString,
  blockers: z
    .array(deletionBlockerSchema)
    .nullish()
    .transform((value) => value ?? null),
});

export type AccountDeletion = z.infer<typeof accountDeletionSchema>;

export const DELETION_STATUSES = ["REQUESTED", "ANONYMIZED", "REJECTED"] as const;

export type DeletionStatus = (typeof DELETION_STATUSES)[number];

/** URL süzgeci: "hepsi" backend'e `status` göndermez. */
export const DELETION_STATUS_FILTERS = ["ALL", ...DELETION_STATUSES] as const;

export type DeletionStatusFilter = (typeof DELETION_STATUS_FILTERS)[number];

const STATUS_LABELS: Record<string, string> = {
  ALL: "Tümü",
  REQUESTED: "Bekliyor",
  ANONYMIZED: "Anonimleştirildi",
  REJECTED: "Reddedildi",
};

export function deletionStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export interface DeletionQueueQuery {
  readonly status?: DeletionStatus;
  readonly paging: Paging;
  /** koala-backend#263: talep sahibinin e-postası. */
  readonly query?: string | null;
}

export function getAccountDeletions(
  accessToken: string,
  query: DeletionQueueQuery,
): Promise<PageDto<AccountDeletion>> {
  return koalaApi.get({
    path: ACCOUNT_DELETIONS_PATH,
    schema: pageDtoSchema(accountDeletionSchema),
    query: {
      ...(query.status !== undefined ? { status: query.status } : {}),
      query: searchQueryParam(query.query),
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export function accountDeletionDetailPath(requestId: string): string {
  return `${ACCOUNT_DELETIONS_PATH}/${encodeURIComponent(requestId)}`;
}

/** `GET /admin/account-deletions/{requestId}` — same AccountDeletionDto as the queue. */
export function getAccountDeletion(
  accessToken: string,
  requestId: string,
): Promise<AccountDeletion> {
  return koalaApi.get({
    path: accountDeletionDetailPath(requestId),
    schema: accountDeletionSchema,
    accessToken,
    cache: "no-store",
  });
}

export const REJECTION_MIN_REASON_LENGTH = 10;
export const REJECTION_MAX_REASON_LENGTH = 512;

export function rejectAccountDeletion(
  accessToken: string,
  requestId: string,
  reason: string,
): Promise<AccountDeletion> {
  return koalaApi.post({
    path: `${ACCOUNT_DELETIONS_PATH}/${encodeURIComponent(requestId)}/reject`,
    schema: accountDeletionSchema,
    body: { reason },
    accessToken,
    cache: "no-store",
  });
}
