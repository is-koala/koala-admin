"use server";

import {
  PAYOUT_RECONCILIATION_FIELDS as FIELD,
  type PayoutReconciliationField,
  type PayoutReconciliationState,
} from "@/lib/payout-reconciliation";
import { isKoalaApiError } from "@/server/api/errors";
import { reconcilePayout, type PayoutSettlementEvidence } from "@/server/api/payout-reconciliation";
import { getKoalaAccessToken } from "@/server/auth/session";
import { permissionLabel } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MONEY = /^\d{1,17}(?:\.\d{1,2})?$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/;

const PASSTHROUGH_REFUSALS = new Set([
  "400:PAYOUT_SETTLEMENT_EVIDENCE_MISMATCH",
  "404:PAYOUT_NOT_FOUND",
  "409:PAYOUT_NOT_AWAITING_SETTLEMENT",
  "409:PAYOUT_NO_PROVIDER_REFERENCE",
  "409:PAYOUT_SETTLEMENT_REFERENCE_TAKEN",
  "409:PAYOUT_SETTLEMENT_REFERENCE_CONFLICT",
]);

function hasRealCalendarDate(value: string): boolean {
  const date = /^(\d{4})-(\d{2})-(\d{2})T/.exec(value);
  if (date === null) return false;

  const year = Number(date[1]);
  const month = Number(date[2]);
  const day = Number(date[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return month >= 1 && month <= 12 && day >= 1 && day <= (days[month - 1] ?? 0);
}

function hasJavaInstantOffset(value: string): boolean {
  const offset = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if (offset === null) return false;
  if (offset[1] === "Z") return true;

  const hours = Number(offset[3]);
  const minutes = Number(offset[4]);
  return minutes <= 59 && (hours < 18 || (hours === 18 && minutes === 0));
}

function text(formData: FormData, field: PayoutReconciliationField): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function blocked(message: string, field: PayoutReconciliationField | null = null) {
  return {
    status: "BLOCKED",
    message,
    errorCode: field === null ? "PANEL_PERMISSION_DENIED" : "PANEL_VALIDATION_FAILED",
    requestId: null,
    field,
    payout: null,
  } as const satisfies PayoutReconciliationState;
}

function fieldProblem(
  field: PayoutReconciliationField,
  message: string,
): PayoutReconciliationState {
  return blocked(message, field);
}

function validate(
  payoutId: string,
  evidence: PayoutSettlementEvidence,
): PayoutReconciliationState | null {
  if (!UUID.test(payoutId)) {
    return fieldProblem(FIELD.payoutId, "Geçerli bir hakediş kimliği girin.");
  }
  if (evidence.settlementReference.length < 1 || evidence.settlementReference.length > 128) {
    return fieldProblem(
      FIELD.settlementReference,
      "Ekstre satırı referansı 1–128 karakter olmalı.",
    );
  }
  if (evidence.providerReference.length < 1 || evidence.providerReference.length > 128) {
    return fieldProblem(FIELD.providerReference, "Sağlayıcı referansı 1–128 karakter olmalı.");
  }
  if (!MONEY.test(evidence.amount) || /^0+(?:\.0{1,2})?$/.test(evidence.amount)) {
    return fieldProblem(
      FIELD.amount,
      "Tutar sıfırdan büyük olmalı; en çok 17 tam ve 2 kesir basamağı kullanın.",
    );
  }
  if (evidence.currency.length !== 3) {
    return fieldProblem(FIELD.currency, "Para birimi tam 3 karakter olmalı.");
  }

  const settledAt = Date.parse(evidence.settledAt);
  if (
    !ISO_INSTANT.test(evidence.settledAt) ||
    !hasRealCalendarDate(evidence.settledAt) ||
    !hasJavaInstantOffset(evidence.settledAt) ||
    Number.isNaN(settledAt)
  ) {
    return fieldProblem(
      FIELD.settledAt,
      "Gerçekleşme anını saat dilimiyle ISO-8601 biçiminde girin (ör. 2026-09-09T09:30:00Z).",
    );
  }
  if (settledAt > Date.now()) {
    return fieldProblem(FIELD.settledAt, "Gerçekleşme anı gelecekte olamaz.");
  }

  return null;
}

export async function submitPayoutReconciliation(
  _previous: PayoutReconciliationState,
  formData: FormData,
): Promise<PayoutReconciliationState> {
  // A Server Action is independently reachable. Resolve the permission again
  // on every POST, including malformed ones, before revealing form rules.
  const context = await getStaffContext();
  if (context.failure !== null) {
    return {
      ...blocked(
        "İzinleriniz çözülemediği için mutabakat gönderilmedi. Panel emin olmadığı hiçbir finans işlemini yapmaz.",
      ),
      errorCode: context.failure.kind,
      requestId: context.failure.requestId,
    };
  }
  if (!context.has("payout.reconcile")) {
    return blocked(
      `Bu işlem "${permissionLabel("payout.reconcile")}" iznini gerektiriyor ve hesabınızda bu izin yok.`,
    );
  }

  const submittedPayoutId = text(formData, FIELD.payoutId);
  const evidence: PayoutSettlementEvidence = {
    settlementReference: text(formData, FIELD.settlementReference),
    providerReference: text(formData, FIELD.providerReference),
    amount: text(formData, FIELD.amount),
    currency: text(formData, FIELD.currency),
    settledAt: text(formData, FIELD.settledAt),
  };
  const problem = validate(submittedPayoutId, evidence);
  if (problem !== null) return problem;
  // UUID text is case-insensitive, while the backend serialises UUIDs in
  // canonical lowercase. Use one representation for both the request path and
  // the post-mutation identity check.
  const payoutId = submittedPayoutId.toLowerCase();

  try {
    const payout = await reconcilePayout(await getKoalaAccessToken(), payoutId, evidence);

    if (payout.id !== payoutId || payout.status !== "COMPLETED" || payout.completedAt === null) {
      return {
        status: "REFUSED",
        message:
          "Backend yanıtı istenen hakediş için tamamlanmış bir mutabakat olarak doğrulanamadı; başarı gösterilmedi.",
        errorCode: "UNEXPECTED_RECONCILIATION_RESULT",
        requestId: null,
        field: null,
        payout: null,
      };
    }

    return {
      status: "SUCCEEDED",
      message: "Hakediş banka ekstresiyle mutabık kılındı.",
      errorCode: null,
      requestId: null,
      field: null,
      payout: {
        id: payout.id,
        amount: payout.amount,
        currency: payout.currency,
        completedAt: payout.completedAt,
      },
    };
  } catch (error) {
    if (isKoalaApiError(error)) {
      const hasSafeRequestId = error.requestId !== null && error.requestId.trim().length > 0;
      const isContractRefusal =
        error.hasContractEnvelope &&
        hasSafeRequestId &&
        PASSTHROUGH_REFUSALS.has(`${error.status}:${error.errorCode}`);
      return {
        status: "REFUSED",
        message: isContractRefusal
          ? error.message
          : "Mutabakat gönderilemedi. Lütfen tekrar deneyin.",
        errorCode: error.errorCode,
        requestId: error.requestId,
        field: null,
        payout: null,
      };
    }

    return {
      status: "REFUSED",
      message: "Mutabakat gönderilemedi. Lütfen tekrar deneyin.",
      errorCode: "UNEXPECTED",
      requestId: null,
      field: null,
      payout: null,
    };
  }
}
