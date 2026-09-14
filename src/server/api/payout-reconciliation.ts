import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
import { linkedRecordSchema } from "./shared/linked-record";
import { staffPartySchema } from "./shared/staff-party";
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

/** `entities/SettlementOperation.java` — iyzico onay kuyruğundaki iş türü. */
export const SETTLEMENT_OPERATIONS = ["APPROVE", "DISAPPROVE", "REFUND"] as const;
export type SettlementOperation = (typeof SETTLEMENT_OPERATIONS)[number];

export const SETTLEMENT_OPERATION_LABELS: Record<SettlementOperation, string> = {
  APPROVE: "Onay",
  DISAPPROVE: "Onay iptali",
  REFUND: "İade",
};

/** `entities/SettlementTaskStatus.java`. */
export const SETTLEMENT_TASK_STATUSES = ["PENDING", "SUCCEEDED", "FAILED"] as const;
export type SettlementTaskStatus = (typeof SETTLEMENT_TASK_STATUSES)[number];

export const SETTLEMENT_TASK_STATUS_LABELS: Record<SettlementTaskStatus, string> = {
  PENDING: "Bekliyor",
  SUCCEEDED: "Başarılı",
  FAILED: "Başarısız",
};

export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: "Bekliyor",
  PROCESSING: "İşleniyor",
  COMPLETED: "Tamamlandı",
  FAILED: "Başarısız",
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);

/** `AdminSettlementTaskDto` — bir settlement denemesi. */
export const settlementTaskSchema = z.object({
  id: z.string(),
  operation: z.enum(SETTLEMENT_OPERATIONS),
  status: z.enum(SETTLEMENT_TASK_STATUSES),
  attempts: nullableInt,
  nextAttemptAt: nullableString,
  lastError: nullableString,
  providerTransactionId: nullableString,
  providerReference: nullableString,
  amount: nullableString,
  completedAt: nullableString,
  createdAt: nullableString,
  updatedAt: nullableString,
});

export type SettlementTask = z.infer<typeof settlementTaskSchema>;

/**
 * `AdminPayoutDetailDto` (koala-backend#265). #80'in kanıt alanları —
 * sağlayıcı referansı, alıcı, maskeli IBAN, tutar, para birimi — burada;
 * `settlementTasks` mutabakat geçmişi, `paymentAttempts` bağlı tahsilatlar.
 * Liste şemasından gevşek: detay yeni uç, para metni yine ondalık string
 * ama biçimini burada zorlamak yeni bir alan için bütün sayfayı düşürürdü.
 */
export const payoutDetailSchema = z.object({
  id: z.string(),
  jobAssignmentId: z.string(),
  jobId: nullableString,
  jobTitle: nullableString,
  companyName: nullableString,
  worker: staffPartySchema.nullish().transform((value) => value ?? null),
  employer: staffPartySchema.nullish().transform((value) => value ?? null),
  paymentId: nullableString,
  maskedIban: nullableString,
  amount: nullableString,
  currency: nullableString,
  status: z.enum(PAYOUT_STATUSES),
  providerReference: nullableString,
  settlementReference: nullableString,
  failureReason: nullableString,
  processingAt: nullableString,
  completedAt: nullableString,
  createdAt: nullableString,
  updatedAt: nullableString,
  settlementTasks: z.array(settlementTaskSchema).default([]),
  paymentAttempts: z.array(linkedRecordSchema).default([]),
});

export type PayoutDetail = z.infer<typeof payoutDetailSchema>;

export function payoutPath(payoutId: string): string {
  return `${PAYOUTS_PATH}/${encodeURIComponent(payoutId)}`;
}

export function getPayoutDetail(accessToken: string, payoutId: string): Promise<PayoutDetail> {
  return koalaApi.get({
    path: payoutPath(payoutId),
    schema: payoutDetailSchema,
    accessToken,
    cache: "no-store",
  });
}

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
