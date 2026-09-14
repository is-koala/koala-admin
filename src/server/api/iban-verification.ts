import "server-only";

import { z } from "zod";

import { BANK_ACCOUNT_VERIFICATION_STATUSES } from "@/lib/iban-verification";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
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

export interface IbanPendingQuery {
  readonly paging: Paging;
  /** koala-backend#263: hesap sahibinin ad-soyadı, e-postası ve doğrulama referansı. */
  readonly query?: string | null;
}

export function getPendingIbanVerifications(
  accessToken: string,
  query: IbanPendingQuery,
): Promise<PageDto<IbanPending>> {
  return koalaApi.get({
    path: IBAN_PENDING_PATH,
    schema: pageDtoSchema(ibanPendingSchema),
    query: {
      status: "PENDING",
      query: searchQueryParam(query.query),
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

/**
 * Tek bir bekleyen doğrulama, referansıyla (koala-admin#95).
 *
 * Backend'de `GET .../{reference}` yoktur; kuyruk `query=` ile referansta da
 * arar (koala-backend#263), sonuç burada tam eşleşmeye indirilir. Kısmi
 * eşleşen komşular (`KOALA-9F3A` ararken `KOALA-9F3A1`) elenir. `null`,
 * "PENDING kuyruğunda böyle bir satır yok" demektir — onaylanmış ya da
 * süresi dolmuş bir doğrulama da buraya düşer; nesne sayfası bunu 404 sayar.
 */
export async function findPendingIbanVerification(
  accessToken: string,
  reference: string,
): Promise<IbanPending | null> {
  const page = await koalaApi.get({
    path: IBAN_PENDING_PATH,
    schema: pageDtoSchema(ibanPendingSchema),
    query: {
      status: "PENDING",
      query: searchQueryParam(reference),
      page: 0,
      size: 50,
      sort: "verificationStartedAt,desc",
    },
    accessToken,
    cache: "no-store",
  });

  return page.content.find((row) => row.reference === reference) ?? null;
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
