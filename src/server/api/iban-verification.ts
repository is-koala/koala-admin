import "server-only";

import { z } from "zod";

import { BANK_ACCOUNT_VERIFICATION_STATUSES } from "@/lib/iban-verification";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";
import { safeUserSchema } from "./users";

/**
 * IBAN doğrulama — `AdminController.pendingIbanVerifications` /
 * `confirmIbanVerification`.
 *
 * ```java
 * GET  /admin/bank-account-verifications?status=PENDING
 *      bank.account.verify
 * POST /admin/bank-account-verifications/{reference}/confirm
 *      bank.account.verify  action=bank.account.verify
 * ```
 *
 * Liste yalnız PENDING kuyruğudur; başka status 400'dür. Yanıt maskeli IBAN
 * ve referans taşır; tam IBAN yoktur. Ret ucu yoktur — onay mevcut confirm
 * ucundan, satırdan `?referans=` / `?tutar=` ile yapılır.
 *
 * Confirm tutarı `ConfirmIbanTransferDto.amount` BigDecimal; panel onu
 * ondalık metin olarak tutar ve JSON'da string gönderir ki JS Number 17 tam
 * basamağı kaybetmesin. Jackson BigDecimal'i string'den de okur.
 */

export const IBAN_PENDING_PATH = "/admin/bank-account-verifications";

/** `BankAccountManager.PENDING_SORTABLE` / default `verificationStartedAt,desc`. */
export const IBAN_PENDING_PAGING: PagingContract = {
  sortable: ["createdAt", "verificationStartedAt"],
  defaultSort: { field: "verificationStartedAt", direction: "desc" },
};

const moneySchema = z.union([z.number(), z.string()]);

const nullableInstant = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const ibanPendingSchema = z.object({
  accountId: z.uuid(),
  user: safeUserSchema,
  maskedIban: z.string(),
  reference: z.string(),
  amount: moneySchema.nullish().transform((value) => value ?? null),
  startedAt: nullableInstant,
  expiresAt: nullableInstant,
  createdAt: nullableInstant,
});

export type IbanPending = z.infer<typeof ibanPendingSchema>;

export function ibanPendingAmountText(amount: IbanPending["amount"]): string {
  if (amount === null) return "";
  return typeof amount === "string" ? amount : amount.toFixed(2);
}

export function ibanVerificationConfirmPath(reference: string): string {
  return `${IBAN_PENDING_PATH}/${encodeURIComponent(reference)}/confirm`;
}

export interface ConfirmIbanTransfer {
  readonly senderIban: string;
  readonly amount: string;
  readonly senderName?: string;
}

const bankAccountSchema = z.object({
  id: z.uuid(),
  maskedIban: z.string(),
  primary: z.boolean(),
  verificationStatus: z.enum(BANK_ACCOUNT_VERIFICATION_STATUSES),
});

export type BankAccount = z.infer<typeof bankAccountSchema>;

export function getPendingIbanVerifications(
  accessToken: string,
  paging: Paging,
): Promise<PageDto<IbanPending>> {
  return koalaApi.get({
    path: IBAN_PENDING_PATH,
    schema: pageDtoSchema(ibanPendingSchema),
    query: {
      status: "PENDING",
      ...pagingQuery(paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export function confirmIbanVerification(
  accessToken: string,
  reference: string,
  observation: ConfirmIbanTransfer,
): Promise<BankAccount> {
  return koalaApi.post({
    path: ibanVerificationConfirmPath(reference),
    accessToken,
    body: observation,
    schema: bankAccountSchema,
    cache: "no-store",
  });
}
