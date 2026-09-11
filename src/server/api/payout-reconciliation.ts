import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
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

export const ADMIN_PAYOUTS_PATH = "/admin/payouts";

/**
 * koala-backend#210 / #211. Manager istemci sıralamasını yok sayıp
 * `createdAt DESC` zorlar; boyut 50'de kesilir. Status bilinçli olarak
 * gönderilmez: boş `status=` yalnız PROCESSING döner. COMPLETED gönderilirse
 * operatörün mutabık kılamayacağı satırlar listelenir.
 */
export const PAYOUT_QUEUE_PAGING: PagingContract = {
  sortable: ["createdAt"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export function getAdminPayouts(accessToken: string, paging: Paging): Promise<PageDto<Payout>> {
  return koalaApi.get({
    path: ADMIN_PAYOUTS_PATH,
    schema: pageDtoSchema(payoutSchema),
    query: pagingQuery(paging),
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
