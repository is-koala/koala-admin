"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { decisionRejected, type DecisionState } from "@/components/panel/queue/decision-state";
import {
  COMPANY_DECISION_MAX_NOTE_LENGTH,
  COMPANY_DECISION_MIN_NOTE_LENGTH,
  approveCompany,
  rejectCompany,
} from "@/server/api/companies";
import { getKoalaAccessToken } from "@/server/auth/session";
import { decisionFailureFrom, guardDecision } from "@/server/queue/decisions";

const RETURN_ORIGIN = "http://koala-admin.invalid";

const COMPANY_OBJECT =
  /^\/companies\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isCompanyReturnPath(pathname: string): boolean {
  return pathname === "/companies" || COMPANY_OBJECT.test(pathname);
}

function successLocation(returnTo: string, decision: "APPROVE" | "REJECT"): Route {
  let location = new URL("/companies", RETURN_ORIGIN);

  try {
    const candidate = new URL(returnTo, RETURN_ORIGIN);
    if (candidate.origin === RETURN_ORIGIN && isCompanyReturnPath(candidate.pathname)) {
      location = candidate;
    }
  } catch {
    // A malformed or external return target falls back to the queue root.
  }

  location.hash = "";
  location.searchParams.set("sonuc", decision === "APPROVE" ? "approved" : "rejected");
  return `${location.pathname}${location.search}` as Route;
}

/**
 * The approval queue's two backend decisions.
 *
 * `guardDecision("company.approve")` comes first for the reason it always does:
 * this is a POST endpoint with its own URL, and the gate on `/companies` never
 * runs for it. A MODERATOR holding `content.moderate` must not be able to
 * approve or reject a company by posting here, and `actions.test.ts` asserts
 * both request counts stay at zero. Failures return presentation state; a
 * success redirects to page-level feedback that survives the decided row
 * leaving the queue. The staff token and API response remain server-side.
 */

export async function submitCompanyDecision(
  _state: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const denied = await guardDecision("company.approve");
  if (denied !== null) return denied;

  const companyId = String(formData.get("companyId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim();

  if (companyId === "") {
    return decisionRejected("Şirket kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  if (decision !== "APPROVE" && decision !== "REJECT") {
    return decisionRejected("Geçerli bir şirket kararı seçin.", "decision");
  }

  if (note.length < COMPANY_DECISION_MIN_NOTE_LENGTH) {
    return decisionRejected(
      `Karar gerekçesi en az ${COMPANY_DECISION_MIN_NOTE_LENGTH} karakter olmalı. Kararı neye dayanarak verdiğiniz yazılı kalsın.`,
      "note",
    );
  }

  if (note.length > COMPANY_DECISION_MAX_NOTE_LENGTH) {
    return decisionRejected(
      `Karar gerekçesi en fazla ${COMPANY_DECISION_MAX_NOTE_LENGTH} karakter olabilir.`,
      "note",
    );
  }

  try {
    const accessToken = await getKoalaAccessToken();
    if (decision === "APPROVE") {
      await approveCompany(accessToken, companyId, note);
    } else {
      await rejectCompany(accessToken, companyId, note);
    }
  } catch (error) {
    return decisionFailureFrom(error, "Karar gönderilemedi.");
  }

  try {
    revalidatePath("/companies");
    revalidatePath(`/companies/${companyId}`);
  } catch {
    // The redirect performs a fresh Server Component load even if cache invalidation fails.
  }

  redirect(successLocation(returnTo, decision));
}
