"use server";

import {
  IBAN_VERIFICATION_FIELDS as FIELD,
  isTurkishIban,
  type IbanVerificationField,
  type IbanVerificationState,
} from "@/lib/iban-verification";
import { isKoalaApiError } from "@/server/api/errors";
import { confirmIbanVerification } from "@/server/api/iban-verification";
import { getKoalaAccessToken } from "@/server/auth/session";
import { guardDecision } from "@/server/queue/decisions";

const MONEY = /^\d{1,17}(?:\.\d{1,2})?$/;

const PASSTHROUGH_REFUSALS = new Set([
  "400:BANK_ACCOUNT_VERIFICATION_SENDER_MISMATCH",
  "400:BANK_ACCOUNT_VERIFICATION_AMOUNT_MISMATCH",
  "400:BANK_ACCOUNT_VERIFICATION_EXPIRED",
  "404:BANK_ACCOUNT_VERIFICATION_NOT_FOUND",
  "409:BANK_ACCOUNT_VERIFICATION_ALREADY_VERIFIED",
]);

function text(formData: FormData, field: IbanVerificationField): string {
  const value = formData.get(field);
  return typeof value === "string" ? value.trim() : "";
}

function blocked(message: string, field: IbanVerificationField | null = null) {
  return {
    status: "BLOCKED",
    message,
    errorCode: field === null ? "PANEL_PERMISSION_DENIED" : "PANEL_VALIDATION_FAILED",
    requestId: null,
    field,
    account: null,
  } as const satisfies IbanVerificationState;
}

export async function submitIbanVerification(
  _previous: IbanVerificationState,
  formData: FormData,
): Promise<IbanVerificationState> {
  const denied = await guardDecision("bank.account.verify");
  if (denied !== null) {
    return {
      status: "BLOCKED",
      message: denied.message,
      errorCode: denied.errorCode ?? "PANEL_PERMISSION_DENIED",
      requestId: denied.requestId,
      field: null,
      account: null,
    } satisfies IbanVerificationState;
  }

  const reference = text(formData, FIELD.reference);
  const senderIban = text(formData, FIELD.senderIban).replaceAll(/\s/g, "").toUpperCase();
  const amount = text(formData, FIELD.amount);
  const senderName = text(formData, FIELD.senderName);

  if (reference.length < 1 || reference.length > 128) {
    return blocked("Ekstre açıklamasındaki referansı 1–128 karakter girin.", FIELD.reference);
  }
  if (!isTurkishIban(senderIban)) {
    return blocked(
      "Gönderen TR IBAN'ını boşluksuz veya boşluklu, geçerli checksum ile girin.",
      FIELD.senderIban,
    );
  }
  if (!MONEY.test(amount) || /^0+(?:\.0{1,2})?$/.test(amount)) {
    return blocked(
      "Tutar sıfırdan büyük olmalı; en çok 17 tam ve 2 kesir basamağı kullanın.",
      FIELD.amount,
    );
  }
  if (senderName.length > 255) {
    return blocked("Hesap sahibi adı 255 karakteri aşamaz.", FIELD.senderName);
  }

  try {
    const account = await confirmIbanVerification(await getKoalaAccessToken(), reference, {
      senderIban,
      amount,
      ...(senderName.length === 0 ? {} : { senderName }),
    });

    if (account.verificationStatus !== "VERIFIED") {
      return {
        status: "REFUSED",
        message: "Backend yanıtı doğrulanmış bir hesap olarak doğrulanamadı; başarı gösterilmedi.",
        errorCode: "UNEXPECTED_VERIFICATION_RESULT",
        requestId: null,
        field: null,
        account: null,
      };
    }

    return {
      status: "SUCCEEDED",
      message: "IBAN doğrulaması tamamlandı.",
      errorCode: null,
      requestId: null,
      field: null,
      account: {
        id: account.id,
        maskedIban: account.maskedIban,
        primary: account.primary,
        verificationStatus: account.verificationStatus,
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
          : "Doğrulama gönderilemedi. Lütfen tekrar deneyin.",
        errorCode: error.errorCode,
        requestId: error.requestId,
        field: null,
        account: null,
      };
    }

    return {
      status: "REFUSED",
      message: "Doğrulama gönderilemedi. Lütfen tekrar deneyin.",
      errorCode: "UNEXPECTED",
      requestId: null,
      field: null,
      account: null,
    };
  }
}
