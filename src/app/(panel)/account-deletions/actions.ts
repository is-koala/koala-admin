"use server";

import {
  decisionRejected,
  decisionSucceeded,
  type DecisionState,
} from "@/components/panel/queue/decision-state";
import {
  REJECTION_MAX_REASON_LENGTH,
  REJECTION_MIN_REASON_LENGTH,
  rejectAccountDeletion,
} from "@/server/api/account-deletions";
import { getKoalaAccessToken } from "@/server/auth/session";
import { decisionFailureFrom, guardDecision } from "@/server/queue/decisions";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function submitDeletionRejection(
  _state: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const denied = await guardDecision("user.deletion.manage");
  if (denied !== null) return denied;

  const requestId = field(formData, "requestId").trim();
  const decision = field(formData, "decision").trim();
  const note = field(formData, "note").trim();

  if (requestId === "") {
    return decisionRejected("Talep kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  if (decision !== "REJECT") {
    return decisionRejected("Geçerli bir karar seçin.", "decision");
  }

  if (note.length < REJECTION_MIN_REASON_LENGTH) {
    return decisionRejected(
      `Ret gerekçesi en az ${REJECTION_MIN_REASON_LENGTH} karakter olmalı.`,
      "note",
    );
  }

  if (note.length > REJECTION_MAX_REASON_LENGTH) {
    return decisionRejected(
      `Ret gerekçesi en fazla ${REJECTION_MAX_REASON_LENGTH} karakter olabilir.`,
      "note",
    );
  }

  try {
    await rejectAccountDeletion(await getKoalaAccessToken(), requestId, note);
    return decisionSucceeded("Hesap silme talebi reddedildi. Anonimleştirme bu talep için durur.");
  } catch (error) {
    return decisionFailureFrom(error, "Ret gönderilemedi.");
  }
}
