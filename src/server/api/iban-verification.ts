import "server-only";

import { z } from "zod";

import { BANK_ACCOUNT_VERIFICATION_STATUSES } from "@/lib/iban-verification";

import { koalaApi } from "./koala";

/**
 * IBAN doğrulama onayı — `AdminController.confirmIbanVerification`.
 *
 * ```java
 * POST /admin/bank-account-verifications/{reference}/confirm
 *   bank.account.verify  action=bank.account.verify
 * ```
 *
 * Liste ucu yok; referans ekstre açıklamasından gelir. Tutar
 * `ConfirmIbanTransferDto.amount` BigDecimal; panel onu ondalık metin olarak
 * tutar ve JSON'da string gönderir ki JS Number 17 tam basamağı kaybetmesin.
 * Jackson BigDecimal'i string'den de okur.
 */

export function ibanVerificationConfirmPath(reference: string): string {
  return `/admin/bank-account-verifications/${encodeURIComponent(reference)}/confirm`;
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
