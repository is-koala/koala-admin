import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";

/**
 * `GET /admin/finance/summary` — koala-admin#50 / koala-backend#186.
 *
 * `finance.read` toplu rapordur; `payment.read` tekil atama özeti (#49) değildir.
 * Tutarlar ondalık metin: sayıyı `Number`'a çevirmek kuruşu kaybeder, Zod
 * reddeder.
 */

export const FINANCE_SUMMARY_PATH = "/admin/finance/summary";

const moneySchema = z.string().regex(/^\d+(?:\.\d+)?$/);

const financeSummarySchema = z.object({
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  currency: z.string().length(3),
  employerVolume: moneySchema,
  koalaFee: moneySchema,
  workerPayout: moneySchema,
  succeededPaymentCount: z.number().int().nonnegative(),
  completedPayoutAmount: moneySchema,
  completedPayoutCount: z.number().int().nonnegative(),
  awaitingPayoutAmount: moneySchema,
  awaitingPayoutCount: z.number().int().nonnegative(),
});

export type FinanceSummary = z.infer<typeof financeSummarySchema>;

export interface FinanceSummaryParams {
  readonly from?: string | null;
  readonly to?: string | null;
  readonly currency?: string | null;
}

export async function getFinanceSummary(
  accessToken: string,
  query: FinanceSummaryParams = {},
): Promise<FinanceSummary> {
  return koalaApi.get({
    path: FINANCE_SUMMARY_PATH,
    accessToken,
    query: {
      from: query.from,
      to: query.to,
      currency: query.currency,
    },
    schema: financeSummarySchema,
    cache: "no-store",
  });
}
