import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";

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
