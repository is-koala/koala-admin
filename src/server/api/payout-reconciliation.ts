import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
import type { PageDto } from "./types";

/** `PayoutStatus.java`, verbatim. */
export const PAYOUT_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** `core/dtos/payout/response/PayoutDto.java`. Money stays decimal text. */
export interface Payout {
  readonly id: string;
  readonly jobAssignmentId: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: PayoutStatus;
  readonly failureReason: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
}

export const PAYOUTS_PATH = "/admin/payouts";

/**
 * Liste ucu client sort'u yok sayar; `createdAt,desc` yedek olarak gider.
 * Boyut tavanı backend'de 50 — PageableSanitizer yok.
 */
export const PAYOUT_PAGING: PagingContract = {
  sortable: ["createdAt"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

const payoutSchema = z.object({
  id: z.uuid(),
  jobAssignmentId: z.uuid(),
  amount: z.string().regex(/^\d+(?:\.\d+)?$/),
  currency: z.string().length(3),
  status: z.enum(PAYOUT_STATUSES),
  failureReason: z.string().nullable(),
  completedAt: z.iso.datetime({ offset: true }).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});

/** `ConfirmPayoutSettlementDto.java`. Amount is deliberately decimal text. */
export interface PayoutSettlementEvidence {
  readonly settlementReference: string;
  readonly providerReference: string;
  readonly amount: string;
  readonly currency: string;
  readonly settledAt: string;
}

export interface PayoutQueueQuery {
  readonly paging: Paging;
  readonly status?: PayoutStatus | null;
  /** koala-backend#263: hakediş id'si, atama id'si, alıcının ad-soyadı ve e-postası. */
  readonly query?: string | null;
}

export function getPayouts(accessToken: string, query: PayoutQueueQuery): Promise<PageDto<Payout>> {
  return koalaApi.get({
    path: PAYOUTS_PATH,
    schema: pageDtoSchema(payoutSchema),
    query: {
      ...(query.status ? { status: query.status } : {}),
      query: searchQueryParam(query.query),
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export async function reconcilePayout(
  accessToken: string,
  payoutId: string,
  evidence: PayoutSettlementEvidence,
): Promise<Payout> {
  return koalaApi.post({
    path: `/admin/payouts/${encodeURIComponent(payoutId)}/reconcile`,
    accessToken,
    body: evidence,
    schema: payoutSchema,
    cache: "no-store",
  });
}
