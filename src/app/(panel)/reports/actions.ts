"use server";

import {
  decisionRejected,
  decisionSucceeded,
  type DecisionState,
} from "@/components/panel/queue/decision-state";
import {
  REVIEW_MIN_NOTE_LENGTH,
  reportStatusLabel,
  reviewReport,
  type ReportStatus,
} from "@/server/api/reports";
import { getKoalaAccessToken } from "@/server/auth/session";
import { decisionFailureFrom, guardDecision } from "@/server/queue/decisions";

/**
 * The one mutating thing the report queue does.
 *
 * A `"use server"` export is a POST endpoint with a generated URL, reachable by
 * anyone who can reach the app. The `<RequirePermission>` on `/reports` gated
 * the *page*, and a page is not what gets posted to — so `guardDecision` runs
 * first and asks the backend again. `@RequiresPermission(CONTENT_MODERATE,
 * action = "report.review")` on `ReportsController.review` remains the
 * authority; this refuses earlier and in words.
 *
 * Nothing here revalidates a path deliberately. `(panel)/layout.tsx` is
 * `force-dynamic` and every Koala call is `cache: "no-store"`, so there is no
 * cached page to invalidate — the router re-renders the route with the action's
 * response and the queue is re-fetched on the way. A `revalidatePath` here
 * would be a no-op that read like a safeguard.
 *
 * Nothing but an async function is exported, either: a `"use server"` module
 * that exports a constant fails the build with every one of its exports
 * missing, which is a confusing way to find out. `REVIEW_MIN_NOTE_LENGTH`
 * therefore lives in `src/server/api/reports.ts`.
 */

/**
 * The verdicts on offer, and why `OPEN` is not one of them.
 *
 * `ReportStatus` has four members, but "put it back to OPEN" is the absence of
 * a decision rather than a decision, and it would let a reviewer quietly undo a
 * colleague's `UNDER_REVIEW` with no record that anything happened. The other
 * three are koala-admin#7's "haklı / haksız / ek bilgi", in that order.
 */
const DECISIONS = [
  "ACTIONED",
  "DISMISSED",
  "UNDER_REVIEW",
] as const satisfies readonly ReportStatus[];

function isDecision(value: string): value is (typeof DECISIONS)[number] {
  return (DECISIONS as readonly string[]).includes(value);
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function submitReportReview(
  _state: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  // Authorise before validating. A caller with no `content.moderate` should
  // learn that, not learn how this form is shaped.
  const denied = await guardDecision("content.moderate");
  if (denied !== null) return denied;

  const reportId = field(formData, "reportId").trim();
  const decision = field(formData, "decision").trim();
  const note = field(formData, "note").trim();

  if (reportId === "") {
    return decisionRejected("Şikayet kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  if (!isDecision(decision)) {
    return decisionRejected("Geçerli bir karar seçin.", "decision");
  }

  if (note.length < REVIEW_MIN_NOTE_LENGTH) {
    // The backend accepts an empty `note` (`@Size(max = 2000)`, no `@NotBlank`).
    // koala-admin#7 does not, and this is where that difference is enforced.
    return decisionRejected(
      `Karar gerekçesi en az ${REVIEW_MIN_NOTE_LENGTH} karakter olmalı. Gerekçe, kararı sonradan okuyacak kişi için yazılıyor.`,
      "note",
    );
  }

  try {
    const reviewed = await reviewReport(await getKoalaAccessToken(), reportId, {
      status: decision,
      note,
    });

    return decisionSucceeded(
      `Şikayet "${reportStatusLabel(reviewed.status)}" olarak kaydedildi. Karar mobil taraftaki GET /reports/me yanıtına da yansır.`,
    );
  } catch (error) {
    return decisionFailureFrom(error, "Karar gönderilemedi.");
  }
}
