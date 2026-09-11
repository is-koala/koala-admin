import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * TCKK belge kuyruğu — `webAPI/AdminController.java` ve
 * `IdentityVerificationManager`.
 *
 * ```
 * GET  /admin/identity-verifications?status=PENDING|APPROVED|REJECTED
 * POST /admin/identity-verifications/{id}/approve
 * POST /admin/identity-verifications/{id}/reject  { reason }
 * ```
 *
 * Onay gövdesizdir ve `identityVerified` damgasını çip olmadan koyar.
 * Fotoğraflar bu dilimde yalnız belge kimliği olarak gelir; imzalı indirme yok.
 */

export const IDENTITY_REVIEWS_PATH = "/admin/identity-verifications";

export const IDENTITY_REVIEW_PAGING: PagingContract = {
  sortable: ["createdAt", "id"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const IDENTITY_REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type IdentityReviewStatus = (typeof IDENTITY_REVIEW_STATUSES)[number];

export const identityReviewSchema = z.object({
  id: z.string(),
  userId: nullableString,
  firstName: nullableString,
  lastName: nullableString,
  tcIdentityNumber: nullableString,
  tcDocumentNumber: nullableString,
  birthDate: nullableString,
  status: z.enum(IDENTITY_REVIEW_STATUSES),
  rejectionReason: nullableString,
  rejectedAt: nullableString,
  verifiedAt: nullableString,
  reviewedByStaffId: nullableString,
  frontDocumentId: nullableString,
  backDocumentId: nullableString,
  createdAt: nullableString,
});

export type IdentityReview = z.infer<typeof identityReviewSchema>;

const STATUS_LABELS: Record<IdentityReviewStatus, string> = {
  PENDING: "Onay bekliyor",
  APPROVED: "Onaylı",
  REJECTED: "Reddedildi",
};

export function identityReviewStatusLabel(status: string): string {
  return STATUS_LABELS[status as IdentityReviewStatus] ?? status;
}

export interface IdentityReviewQueueQuery {
  readonly status: IdentityReviewStatus;
  readonly paging: Paging;
}

export function getIdentityReviews(
  accessToken: string,
  query: IdentityReviewQueueQuery,
): Promise<PageDto<IdentityReview>> {
  return koalaApi.get({
    path: IDENTITY_REVIEWS_PATH,
    schema: pageDtoSchema(identityReviewSchema),
    query: {
      status: query.status,
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export const IDENTITY_REJECTION_MIN_REASON_LENGTH = 10;
export const IDENTITY_REJECTION_MAX_REASON_LENGTH = 1000;

export function approveIdentityReview(
  accessToken: string,
  reviewId: string,
): Promise<IdentityReview> {
  return koalaApi.post({
    path: `${IDENTITY_REVIEWS_PATH}/${encodeURIComponent(reviewId)}/approve`,
    schema: identityReviewSchema,
    accessToken,
    cache: "no-store",
  });
}

export function rejectIdentityReview(
  accessToken: string,
  reviewId: string,
  reason: string,
): Promise<IdentityReview> {
  return koalaApi.post({
    path: `${IDENTITY_REVIEWS_PATH}/${encodeURIComponent(reviewId)}/reject`,
    schema: identityReviewSchema,
    body: { reason },
    accessToken,
    cache: "no-store",
  });
}
