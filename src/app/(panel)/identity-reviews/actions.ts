"use server";

import type { Route } from "next";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { decisionRejected, type DecisionState } from "@/components/panel/queue/decision-state";
import {
  IDENTITY_REJECTION_MAX_REASON_LENGTH,
  IDENTITY_REJECTION_MIN_REASON_LENGTH,
  approveIdentityReview,
  rejectIdentityReview,
} from "@/server/api/identity-reviews";
import { getKoalaAccessToken } from "@/server/auth/session";
import { decisionFailureFrom, guardDecision } from "@/server/queue/decisions";

const RETURN_ORIGIN = "http://koala-admin.invalid";

function successLocation(returnTo: string, decision: "APPROVE" | "REJECT"): Route {
  let location = new URL("/identity-reviews", RETURN_ORIGIN);

  try {
    const candidate = new URL(returnTo, RETURN_ORIGIN);
    if (candidate.origin === RETURN_ORIGIN && candidate.pathname === "/identity-reviews") {
      location = candidate;
    }
  } catch {
    // malformed return target falls back to the queue root
  }

  location.hash = "";
  location.searchParams.set("sonuc", decision === "APPROVE" ? "approved" : "rejected");
  return `${location.pathname}${location.search}` as Route;
}

export async function submitIdentityReviewDecision(
  _state: DecisionState,
  formData: FormData,
): Promise<DecisionState> {
  const denied = await guardDecision("identity.review");
  if (denied !== null) return denied;

  const reviewId = String(formData.get("reviewId") ?? "").trim();
  const decision = String(formData.get("decision") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim();

  if (reviewId === "") {
    return decisionRejected("İnceleme kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  if (decision !== "APPROVE" && decision !== "REJECT") {
    return decisionRejected("Geçerli bir kimlik kararı seçin.", "decision");
  }

  if (decision === "REJECT") {
    if (reason.length < IDENTITY_REJECTION_MIN_REASON_LENGTH) {
      return decisionRejected(
        `Ret gerekçesi en az ${IDENTITY_REJECTION_MIN_REASON_LENGTH} karakter olmalı.`,
        "reason",
      );
    }
    if (reason.length > IDENTITY_REJECTION_MAX_REASON_LENGTH) {
      return decisionRejected(
        `Ret gerekçesi en fazla ${IDENTITY_REJECTION_MAX_REASON_LENGTH} karakter olabilir.`,
        "reason",
      );
    }
  }

  try {
    const accessToken = await getKoalaAccessToken();
    if (decision === "APPROVE") {
      await approveIdentityReview(accessToken, reviewId);
    } else {
      await rejectIdentityReview(accessToken, reviewId, reason);
    }
  } catch (error) {
    return decisionFailureFrom(error, "Karar gönderilemedi.");
  }

  try {
    revalidatePath("/identity-reviews");
  } catch {
    // redirect still reloads the queue
  }

  redirect(successLocation(returnTo, decision));
}
