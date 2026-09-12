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
 * GET  /admin/identity-verifications/{id}
 * GET  /admin/identity-verifications/{id}/documents/{documentId}/download
 * POST /admin/identity-verifications/{id}/approve
 * POST /admin/identity-verifications/{id}/reject  { reason }
 * ```
 *
 * Onay gövdesizdir ve `identityVerified` damgasını çip olmadan koyar.
 * Kuyruk DTO'su depo anahtarı taşımaz; fotoğraf baytları same-origin BFF'den
 * okunur (`/api/identity-verifications/.../download`).
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
  selfieDocumentId: nullableString,
  frontDocumentId: nullableString,
  backDocumentId: nullableString,
  togetherDocumentId: nullableString,
  createdAt: nullableString,
});

export type IdentityReview = z.infer<typeof identityReviewSchema>;

/**
 * Onayın dört kanıtı var mı? Panel ve Server Action aynı kümeyi kullanır ki
 * UI'ın kapattığını eylem de reddetsin; eski iki fotoğraflı PENDING kayıt
 * ekranda açık durup POST'ta geçmesin.
 */
export function identityReviewDocumentsComplete(
  review: Pick<
    IdentityReview,
    "selfieDocumentId" | "frontDocumentId" | "backDocumentId" | "togetherDocumentId"
  >,
): boolean {
  return (
    hasDocumentId(review.selfieDocumentId) &&
    hasDocumentId(review.frontDocumentId) &&
    hasDocumentId(review.backDocumentId) &&
    hasDocumentId(review.togetherDocumentId)
  );
}

function hasDocumentId(value: string | null): boolean {
  return value !== null && value.trim().length > 0;
}

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

export function identityReviewDetailPath(reviewId: string): string {
  return `${IDENTITY_REVIEWS_PATH}/${encodeURIComponent(reviewId)}`;
}

/** `GET /admin/identity-verifications/{reviewId}` — same IdentityReviewDto as the queue. */
export function getIdentityReview(accessToken: string, reviewId: string): Promise<IdentityReview> {
  return koalaApi.get({
    path: identityReviewDetailPath(reviewId),
    schema: identityReviewSchema,
    accessToken,
    cache: "no-store",
  });
}

export const IDENTITY_REJECTION_MIN_REASON_LENGTH = 10;
export const IDENTITY_REJECTION_MAX_REASON_LENGTH = 1000;

export function identityDocumentDownloadPath(reviewId: string, documentId: string): string {
  return `${IDENTITY_REVIEWS_PATH}/${encodeURIComponent(reviewId)}/documents/${encodeURIComponent(documentId)}/download`;
}

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
