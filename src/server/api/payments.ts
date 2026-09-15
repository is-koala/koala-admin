import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { pricingBreakdownSchema } from "./shared/pricing";
import type { PageDto } from "./types";
import { safeUserSchema } from "./users";

/**
 * Ödeme denemeleri — `AdminController.assignmentPayments` / `payment`
 * (koala-backend#265).
 *
 * ```java
 * GET /admin/job-assignments/{assignmentId}/payments  payment.read
 * GET /admin/payments/{paymentId}                     payment.read
 * GET /admin/payments?status=                         payment.read  Pageable
 * ```
 *
 * Liste koala-backend#301 ile geldi: `status` çoklu (virgülle tek parametre),
 * verilmezse her durum; satır tekil detayla aynı `AdminPaymentDto`. İşçisi
 * anonimleştirilmiş atamanın FAILED denemesi listeden düşer (backend INNER
 * join, CLAUDE.md'de yazılı); bekleyen denemeler hesap silmeyi engellediği
 * için takılı ödeme kaybolmaz.
 *
 * `AdminPaymentDto` tek bir tahsilat denemesidir: durum, tutar dökümü,
 * sağlayıcı referansları, doğrulama sayacı ve iade kayıtları. Kart verisi ve
 * ödeme token'ı yoktur — backend bunları hiç seri hâle getirmez, panel de
 * bir alan adı bile ayırmaz. Taraflar `SafeUserDto` (e-posta yok).
 *
 * Para alanları backend'in `toPlainString()` çıktısıdır ve metin olarak
 * kalır; `formatCurrency` ikisini de okur, sayıya çevirmek 17 tam basamağı
 * kaybederdi.
 */

/** `entities/PaymentAttemptStatus.java`. */
export const PAYMENT_ATTEMPT_STATUSES = [
  "INITIATED",
  "VERIFY_PENDING",
  "IN_REVIEW",
  "SUCCEEDED",
  "FAILED",
] as const;

export type PaymentAttemptStatus = (typeof PAYMENT_ATTEMPT_STATUSES)[number];

export const PAYMENT_ATTEMPT_STATUS_LABELS: Record<PaymentAttemptStatus, string> = {
  INITIATED: "Başlatıldı",
  VERIFY_PENDING: "Doğrulama bekliyor",
  IN_REVIEW: "İncelemede",
  SUCCEEDED: "Başarılı",
  FAILED: "Başarısız",
};

/** `entities/RefundStatus.java`. */
export const REFUND_STATUSES = ["PENDING", "PROCESSING", "COMPLETED", "FAILED"] as const;

export type RefundStatus = (typeof REFUND_STATUSES)[number];

export const REFUND_STATUS_LABELS: Record<RefundStatus, string> = {
  PENDING: "Bekliyor",
  PROCESSING: "İşleniyor",
  COMPLETED: "Tamamlandı",
  FAILED: "Başarısız",
};

/**
 * `entities/RefundOrigin.java` — iadeyi kim doğurdu (koala-backend#283,
 * türetilir). Yalnız gösterim: serbest dize, bilinmeyen kod olduğu gibi
 * yazılır. `z.enum` bu dosyada yalnız para durumu taşıyan `status`larda.
 */
export const REFUND_ORIGINS = ["CANCELLATION", "DISPUTE", "STAFF"] as const;

export type RefundOrigin = (typeof REFUND_ORIGINS)[number];

const REFUND_ORIGIN_LABELS: Readonly<Record<string, string>> = {
  CANCELLATION: "İptal",
  DISPUTE: "Uyuşmazlık",
  STAFF: "Personel",
} satisfies Record<RefundOrigin, string>;

export function refundOriginLabel(origin: string): string {
  return REFUND_ORIGIN_LABELS[origin] ?? origin;
}

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);

/** `AdminRefundDto`. */
export const adminRefundSchema = z.object({
  id: z.string(),
  paymentId: z.string(),
  amount: nullableString,
  currency: nullableString,
  status: z.enum(REFUND_STATUSES),
  reason: nullableString,
  providerRefundId: nullableString,
  /**
   * koala-backend#283: `CANCELLATION` → `originId` iptal kaydı,
   * `DISPUTE` → uyuşmazlık kimliği, `STAFF` → panelden yapılan iade
   * (`originId` boş). Eski sunucuda ikisi de `null`, sütun "—".
   */
  origin: nullableString,
  originId: nullableString,
  completedAt: nullableString,
  createdAt: nullableString,
  updatedAt: nullableString,
});

export type AdminRefund = z.infer<typeof adminRefundSchema>;

/** `AdminPaymentDto`. */
export const adminPaymentSchema = z.object({
  id: z.string(),
  jobAssignmentId: z.string(),
  jobId: nullableString,
  jobTitle: nullableString,
  /** koala-backend#301; eski sunucuda yok → `null`, ad düz metin kalır (koala-admin#105). */
  companyId: nullableString,
  companyName: nullableString,
  worker: safeUserSchema.nullish().transform((value) => value ?? null),
  employer: safeUserSchema.nullish().transform((value) => value ?? null),
  status: z.enum(PAYMENT_ATTEMPT_STATUSES),
  currency: nullableString,
  pricingVersion: nullableString,
  pricing: pricingBreakdownSchema.nullish().transform((value) => value ?? null),
  workerPayout: nullableString,
  commissionAmount: nullableString,
  commissionRate: nullableString,
  totalCharged: nullableString,
  conversationId: nullableString,
  providerPaymentId: nullableString,
  providerTransactionId: nullableString,
  failureReason: nullableString,
  verificationAttempts: nullableInt,
  nextVerificationAt: nullableString,
  completedAt: nullableString,
  createdAt: nullableString,
  updatedAt: nullableString,
  /** koala-backend#283: bu tahsilattan doğan hakediş; `payout.reconcile` ile açılır. */
  payoutId: nullableString,
  refunds: z.array(adminRefundSchema).default([]),
});

export type AdminPayment = z.infer<typeof adminPaymentSchema>;

export const PAYMENTS_PATH = "/admin/payments";

/** `AdminDetailManager.PAYMENT_SORTABLE`; varsayılan yeniden eskiye. */
export const PAYMENT_PAGING: PagingContract = {
  sortable: ["createdAt", "updatedAt", "status", "nextVerificationAt"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export interface PaymentListQuery {
  /** `null`/boş: her durum. Birden çok değer `status=A,B` olarak tek parametre gider. */
  readonly status: PaymentAttemptStatus | readonly PaymentAttemptStatus[] | null;
  readonly paging: Paging;
}

export function getPayments(
  accessToken: string,
  query: PaymentListQuery,
): Promise<PageDto<AdminPayment>> {
  return koalaApi.get({
    path: PAYMENTS_PATH,
    schema: pageDtoSchema(adminPaymentSchema),
    query: {
      status: paymentStatusParam(query.status),
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

function paymentStatusParam(status: PaymentListQuery["status"]): string | undefined {
  if (status === null) return undefined;
  if (typeof status === "string") return status;
  return status.length === 0 ? undefined : status.join(",");
}

export function assignmentPaymentsPath(assignmentId: string): string {
  return `/admin/job-assignments/${encodeURIComponent(assignmentId)}/payments`;
}

export function paymentPath(paymentId: string): string {
  return `/admin/payments/${encodeURIComponent(paymentId)}`;
}

/** Atamanın bütün denemeleri, backend'in sırasıyla (yeniden eskiye). */
export function getAssignmentPayments(
  accessToken: string,
  assignmentId: string,
): Promise<AdminPayment[]> {
  return koalaApi.get({
    path: assignmentPaymentsPath(assignmentId),
    schema: z.array(adminPaymentSchema),
    accessToken,
    cache: "no-store",
  });
}

export function getPayment(accessToken: string, paymentId: string): Promise<AdminPayment> {
  return koalaApi.get({
    path: paymentPath(paymentId),
    schema: adminPaymentSchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * Denemenin para birimi: DTO'nun `currency` alanı, yoksa fiyat dökümününki,
 * o da yoksa TRY. Panel para birimi uydurmaz; TRY yalnız `formatCurrency`
 * için bir biçim varsayılanıdır ve backend bugün başka birim üretmiyor.
 */
export function paymentCurrency(payment: Pick<AdminPayment, "currency" | "pricing">): string {
  return payment.currency ?? payment.pricing?.currency ?? "TRY";
}
