"use server";

import {
  decisionRejected,
  decisionSucceeded,
  type DecisionState,
} from "@/components/panel/queue/decision-state";
import { APPROVAL_MIN_NOTE_LENGTH, approveCompany } from "@/server/api/companies";
import { getKoalaAccessToken } from "@/server/auth/session";
import { getStaffContext } from "@/server/authz/staff-context";
import { decisionFailureFrom, guardDecision } from "@/server/queue/decisions";

/**
 * Approving a company — the only transition koala-backend offers, and a
 * one-way one.
 *
 * `guardDecision("company.approve")` comes first for the reason it always does:
 * this is a POST endpoint with its own URL, and the gate on `/companies` never
 * runs for it. A MODERATOR holding `content.moderate` must not be able to
 * approve a company by posting here, and `actions.test.ts` asserts that as a
 * request count of zero.
 *
 * Two things this file deliberately does *not* do:
 *
 *  - It does not send the approval note. `POST /admin/companies/{companyId}/approve`
 *    takes `@PathVariable UUID companyId` and nothing else; a JSON body would be
 *    quietly discarded and would leave every reader of this code believing the
 *    reason was stored.
 *  - It does not export anything but the action. A `"use server"` module that
 *    exports a constant fails the build with *all* of its exports reported
 *    missing, which is a puzzling way to learn the rule.
 */

/** How the note is recorded until koala-backend#15's audit log exists. */
function logApproval(companyId: string, staffId: string | null, note: string): void {
  /**
   * One line, and emphatically not an audit mechanism: nothing is stored,
   * queried or displayed anywhere in this panel, and koala-backend#15 is the
   * real record. It exists so that a reason the operator was *required* to
   * write is not thrown away between the form and a backend that has nowhere
   * to put it.
   */
  console.info(
    `[company-approval] companyId=${companyId} staffId=${staffId ?? "-"} ` +
      `note=${JSON.stringify(note)} sentToBackend=false`,
  );
}

export async function submitCompanyApproval(
  _state: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const denied = await guardDecision("company.approve");
  if (denied !== null) return denied;

  const companyId = String(formData.get("companyId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();

  if (companyId === "") {
    return decisionRejected("Şirket kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  if (decision !== "APPROVE") {
    // There is exactly one decision. Anything else arriving here means a form
    // that has drifted from the backend, and guessing would be the wrong move
    // on an irreversible action.
    return decisionRejected(
      "Onaydan başka bir karar gönderilemez: koala-backend'de ret ya da onayı geri alma ucu yok.",
      "decision",
    );
  }

  if (note.length < APPROVAL_MIN_NOTE_LENGTH) {
    return decisionRejected(
      `Onay gerekçesi en az ${APPROVAL_MIN_NOTE_LENGTH} karakter olmalı. Onay geri alınamıyor, bu yüzden neye bakarak onayladığınız yazılı kalsın.`,
      "note",
    );
  }

  const context = await getStaffContext();

  try {
    const approved = await approveCompany(await getKoalaAccessToken(), companyId);
    logApproval(companyId, context.staff?.staffId ?? null, note);

    return decisionSucceeded(
      `${approved.name ?? "Şirket"} onaylandı ve artık ilan yayınlayabilir. Gerekçeniz backend'e gönderilmedi — onay ucu not alanı kabul etmiyor; şirket sahibine de bildirim gitmez.`,
    );
  } catch (error) {
    return decisionFailureFrom(error, "Onay gönderilemedi.");
  }
}
