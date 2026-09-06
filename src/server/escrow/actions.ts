"use server";

import { revalidatePath } from "next/cache";

import { ESCROW_FIELD, type EscrowFormState } from "@/lib/escrow-form";
import { isDisputeResolution, type DisputeResolution } from "@/server/api/disputes";

import { runEscrowOperation, type EscrowOperationKind } from "./operations";

/**
 * The one Server Action behind every money button on `/disputes`.
 *
 * A Server Action is a public HTTP endpoint with a hard-to-guess name — not a
 * private function call — so nothing it receives is trusted. This file's whole
 * job is to turn a `FormData` into a typed request and hand it to
 * `runEscrowOperation`, which re-resolves the permission from `/admin/me`,
 * re-reads the amount from the backend and de-duplicates the submission.
 *
 * Note what is *not* here: no branch on `kind` that skips a check, no early
 * return for "the UI already validated this", and no amount taken from the
 * form and put in a request body. One door.
 */

const KINDS: readonly EscrowOperationKind[] = ["RESOLVE_DISPUTE", "RELEASE", "REFUND"];

function text(formData: FormData, field: string): string {
  const value = formData.get(field);
  return typeof value === "string" ? value : "";
}

function optionalText(formData: FormData, field: string): string | null {
  const value = text(formData, field).trim();
  return value.length === 0 ? null : value;
}

export async function submitEscrowOperation(
  _previous: EscrowFormState,
  formData: FormData,
): Promise<EscrowFormState> {
  const operationKey = text(formData, ESCROW_FIELD.operationKey).trim();
  const rawKind = text(formData, ESCROW_FIELD.kind);
  const kind = KINDS.find((candidate) => candidate === rawKind);

  if (kind === undefined) {
    return {
      status: "BLOCKED",
      message: "Bilinmeyen işlem türü. Sayfayı yenileyin.",
      errorCode: "PANEL_VALIDATION_FAILED",
      correlationId: null,
      amountText: null,
      deduplicated: false,
      operationKey: operationKey.length === 0 ? null : operationKey,
    };
  }

  const rawResolution = optionalText(formData, ESCROW_FIELD.resolution);
  const resolution: DisputeResolution | null = isDisputeResolution(rawResolution)
    ? rawResolution
    : null;

  const outcome = await runEscrowOperation({
    operationKey,
    kind,
    assignmentId: text(formData, ESCROW_FIELD.assignmentId).trim(),
    disputeId: optionalText(formData, ESCROW_FIELD.disputeId),
    resolution,
    reason: text(formData, ESCROW_FIELD.reason),
    confirmedAmount: optionalText(formData, ESCROW_FIELD.confirmedAmount),
  });

  if (outcome.status === "SUCCEEDED") {
    // The queue only lists active disputes, so a resolved one has to disappear
    // and a released assignment has to stop offering the button.
    revalidatePath("/disputes");
  }

  return {
    status: outcome.status,
    message: outcome.message,
    errorCode: outcome.errorCode,
    correlationId: outcome.correlationId,
    amountText: outcome.amountText,
    deduplicated: outcome.deduplicated,
    operationKey: operationKey.length === 0 ? null : operationKey,
  };
}
