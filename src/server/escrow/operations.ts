import "server-only";

import { formatCurrency } from "@/lib/format";
import {
  disputeResolutionSpec,
  isDisputeResolution,
  resolveDispute,
  type DisputeResolution,
} from "@/server/api/disputes";
import {
  getEscrowSummary,
  refundEmployer,
  releaseEscrow,
  type EscrowSummary,
  type Money,
} from "@/server/api/escrow";
import { isKoalaApiError } from "@/server/api/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";

import { escrowFigure, normaliseMoney, sameMoney, type EscrowDirection } from "./figures";
import { recordOperation } from "./recent-operations";

/**
 * Every way this panel can move money, behind one function.
 *
 * There are three endpoints and one door. That is the point: the permission
 * re-check, the mandatory reason, the amount re-read and the double-submit
 * guard are written once here, so a future screen that adds a fourth button
 * cannot accidentally skip one of them.
 *
 * ## The four things this function does that a plain `fetch` would not
 *
 * 1. **Re-checks the permission on the server.** The gate in
 *    `require-permission.tsx` decides what to *render*; it decides nothing
 *    about what a POST is allowed to do. A Server Action is a public HTTP
 *    endpoint, so the permission is resolved again here, from `/admin/me`, on
 *    every submission. (The backend checks too — it is the authority — but a
 *    panel that forwarded an unauthorised release and let the backend catch it
 *    would still have tried.)
 *
 * 2. **Requires a reason, in writing.** Free text, non-empty, and long enough
 *    to be a sentence when money moves. The backend's own `note` is optional
 *    (`ResolveDisputeDto` has `@Size` and no `@NotBlank`); koala-admin#6 asks
 *    for it to be mandatory and this is where that is true.
 *
 * 3. **Re-reads the amount before committing.** The confirmation showed a
 *    figure the server supplied; the form posts that figure back; this function
 *    reads the server's number *again* and refuses if the two differ. The
 *    submitted figure is never used as an amount — no request body carries it —
 *    it is used only as proof that the operator confirmed the number the
 *    backend currently holds. A tab left open across a state change cannot
 *    release against a stale figure.
 *
 * 4. **Collapses a double submit into one request.** See
 *    {@link runEscrowOperation}.
 */

export type EscrowOperationKind = "RESOLVE_DISPUTE" | "RELEASE" | "REFUND";

export interface EscrowOperationRequest {
  /**
   * Minted in the browser when the confirmation dialog opens, one per intended
   * movement. Two submissions of the same confirmation carry the same key.
   */
  readonly operationKey: string;
  readonly kind: EscrowOperationKind;
  readonly assignmentId: string;
  /** Required for `RESOLVE_DISPUTE`; null for the standalone escrow operations. */
  readonly disputeId: string | null;
  /** Required for `RESOLVE_DISPUTE`; ignored otherwise. */
  readonly resolution: DisputeResolution | null;
  /** Mandatory free text. */
  readonly reason: string;
  /**
   * The figure the operator confirmed, exactly as the server sent it to the
   * page. Null only for a movement that touches no money (`DISMISSED`).
   */
  readonly confirmedAmount: string | null;
}

export type EscrowOperationStatus =
  /** The backend did it. */
  | "SUCCEEDED"
  /** The backend refused — 403, 409, 404. The operator sees its own message. */
  | "REFUSED"
  /** The panel refused before asking: permission, validation, stale amount. */
  | "BLOCKED";

export interface EscrowOperationOutcome {
  readonly status: EscrowOperationStatus;
  /** Turkish. The backend's own message whenever there is one. */
  readonly message: string;
  readonly errorCode: string | null;
  readonly correlationId: string | null;
  /**
   * The amount the backend reported having moved, formatted through
   * `lib/format`. Null when its response carried no figure — a refund answers a
   * bare `SuccessResult` — and never back-filled from the panel's own read.
   */
  readonly amountText: string | null;
  /** True when this key had already been submitted and no second request was made. */
  readonly deduplicated: boolean;
}

const PERMISSION_FOR: Record<EscrowOperationKind, Permission> = {
  /**
   * Note what this says, and what koala-backend says. `POST /admin/disputes/{id}/resolve`
   * is gated by `dispute.resolve` **alone** — a `PermissionSensitivity.NORMAL`
   * permission — even when the chosen resolution releases escrow or refunds an
   * employer. The panel matches the backend rather than inventing a stricter
   * rule that would lock out a dispute handler the backend would let through;
   * the screen names the consequence out loud instead.
   */
  RESOLVE_DISPUTE: "dispute.resolve",
  RELEASE: "payout.release",
  REFUND: "payment.refund",
};

/** A reason that will be read years later has to be longer than "ok". */
const MIN_MONEY_REASON_LENGTH = 10;
const MAX_REASON_LENGTH = 2000;

/* -------------------------------------------------------------------------- */
/* Double-submit guard                                                         */
/* -------------------------------------------------------------------------- */

interface Submission {
  readonly at: number;
  readonly promise: Promise<EscrowOperationOutcome>;
}

/**
 * Keyed by `operationKey`. Module scope, so it covers one server process.
 *
 * **This is the panel's guard, not the backend's.** The backend has no
 * idempotency key on any of the three endpoints — no header, no field. What it
 * has is state: a second release finds `payoutDao.existsByJobAssignmentId` and
 * creates no second payout; a second refund or a second resolve is refused with
 * 409 because the status already moved. Those make a duplicate *safe*. They do
 * not make it *impossible*, and they do nothing at all for two requests that
 * arrive before the first has committed — which is exactly what a double click
 * produces. Hence this map.
 *
 * Its limit, stated plainly: one process. Behind two panel instances a genuine
 * double submit could still reach the backend twice, and there the state guards
 * above are what stops a second payout. The report for koala-admin#6 says so.
 */
const submissions = new Map<string, Submission>();

/** Long enough to cover a retry-happy operator, short enough not to be a cache. */
const SUBMISSION_RETENTION_MS = 10 * 60_000;

function sweep(now: number): void {
  for (const [key, submission] of submissions) {
    if (now - submission.at > SUBMISSION_RETENTION_MS) {
      submissions.delete(key);
    }
  }
}

/**
 * Perform one money movement, at most once per `operationKey`.
 *
 * Not `async` on purpose. The map lookup and the map write both happen in the
 * synchronous prologue, before any `await` yields the thread, so two submissions
 * that arrive in the same tick cannot both miss the map. An `async` function
 * here would be a race with a comment explaining why it is fine.
 *
 * A refused or blocked operation releases its key, so an operator who fixes the
 * problem can retry; a succeeded one keeps it, so replaying the form cannot
 * release twice.
 */
export function runEscrowOperation(
  request: EscrowOperationRequest,
): Promise<EscrowOperationOutcome> {
  const now = Date.now();
  sweep(now);

  const existing = submissions.get(request.operationKey);
  if (existing !== undefined) {
    return existing.promise.then((outcome) => ({ ...outcome, deduplicated: true }));
  }

  const promise = execute(request).then((outcome) => {
    if (outcome.status !== "SUCCEEDED") {
      submissions.delete(request.operationKey);
    }
    return outcome;
  });

  submissions.set(request.operationKey, { at: now, promise });
  return promise;
}

/** Test seam. Never called by application code. */
export function clearEscrowSubmissions(): void {
  submissions.clear();
}

/* -------------------------------------------------------------------------- */
/* The operation itself                                                        */
/* -------------------------------------------------------------------------- */

function blocked(message: string, errorCode: string): EscrowOperationOutcome {
  return {
    status: "BLOCKED",
    message,
    errorCode,
    correlationId: null,
    amountText: null,
    deduplicated: false,
  };
}

/** Which figure a movement is meant to pay, or `null` when it moves nothing. */
function directionFor(request: EscrowOperationRequest): EscrowDirection | null {
  switch (request.kind) {
    case "RELEASE":
      return "WORKER";
    case "REFUND":
      return "EMPLOYER";
    case "RESOLVE_DISPUTE": {
      if (request.resolution === null) return null;
      const spec = disputeResolutionSpec(request.resolution);
      return spec.beneficiary;
    }
  }
}

function validate(request: EscrowOperationRequest): string | null {
  if (request.operationKey.trim().length === 0) {
    return "İşlem anahtarı yok. Formu yeniden açın.";
  }

  if (request.assignmentId.trim().length === 0) {
    return "Atama kimliği yok.";
  }

  if (request.kind === "RESOLVE_DISPUTE") {
    if (request.disputeId === null || request.disputeId.trim().length === 0) {
      return "Uyuşmazlık kimliği yok.";
    }
    if (!isDisputeResolution(request.resolution)) {
      return "Bir karar seçmelisiniz.";
    }
  }

  const reason = request.reason.trim();
  if (reason.length === 0) {
    return "Gerekçe zorunludur. Bu alan boş bırakılamaz.";
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return `Gerekçe en fazla ${MAX_REASON_LENGTH} karakter olabilir.`;
  }

  const direction = directionFor(request);
  if (direction !== null && reason.length < MIN_MONEY_REASON_LENGTH) {
    return `Para hareketi için gerekçe en az ${MIN_MONEY_REASON_LENGTH} karakter olmalı; bu kayıt denetim için saklanır.`;
  }

  if (direction !== null && (request.confirmedAmount ?? "").trim().length === 0) {
    return "Onaylanan tutar formda yok. Onay penceresini yeniden açın.";
  }

  return null;
}

async function execute(request: EscrowOperationRequest): Promise<EscrowOperationOutcome> {
  const validationError = validate(request);
  if (validationError !== null) {
    return blocked(validationError, "PANEL_VALIDATION_FAILED");
  }

  const context = await getStaffContext();
  if (context.failure !== null) {
    return blocked(
      "İzinleriniz çözülemedi, bu yüzden hiçbir para hareketi yapılmadı. Panel emin olamadığında hiçbir şeye izin vermez.",
      context.failure.kind,
    );
  }

  const permission = PERMISSION_FOR[request.kind];
  if (!context.has(permission)) {
    return blocked(
      `Bu işlem "${permission}" iznini gerektiriyor ve hesabınızda bu izin yok. İstek backend'e hiç gönderilmedi.`,
      "PANEL_PERMISSION_DENIED",
    );
  }

  let accessToken: string;
  try {
    accessToken = await getKoalaAccessToken();
  } catch (error) {
    return blocked(
      `Oturum doğrulanamadı, işlem yapılmadı: ${error instanceof Error ? error.message : String(error)}`,
      "SESSION",
    );
  }

  const direction = directionFor(request);
  let confirmation: ConfirmationCheck | null = null;

  if (direction !== null) {
    confirmation = await confirmAmount(accessToken, request, direction);
    if (confirmation.outcome !== null) {
      return confirmation.outcome;
    }
  }

  const actor = context.staff?.displayName ?? "—";
  const beneficiary = confirmation?.partyName ?? null;
  const reason = request.reason.trim();

  try {
    const success = await send(accessToken, request, reason);

    recordOperation({
      operationKey: request.operationKey,
      kind: request.kind,
      outcome: "SUCCEEDED",
      assignmentId: request.assignmentId,
      disputeId: request.disputeId,
      actor,
      beneficiary,
      amountText: success.amountText,
      reason,
      errorCode: null,
      message: success.message,
      correlationId: success.correlationId,
      at: new Date().toISOString(),
    });

    return {
      status: "SUCCEEDED",
      message: success.message,
      errorCode: null,
      correlationId: success.correlationId,
      amountText: success.amountText,
      deduplicated: false,
    };
  } catch (error) {
    /**
     * The backend's refusal, in the backend's words.
     *
     * `{dispute.blocks.release}`, `{payout.not.refundable}`,
     * `{dispute.already.resolved}` are resolved to Turkish by the backend's
     * `AcceptHeaderLocaleResolver` before they reach us, and the panel sends
     * `Accept-Language: tr`. Rewriting them into a generic "işlem başarısız"
     * would throw away the only sentence that tells the operator what to do
     * next — which, for `BLOCKS_RELEASE`, is "resolve the dispute first".
     */
    const failure = isKoalaApiError(error)
      ? {
          message: error.message,
          errorCode: error.errorCode,
          correlationId: error.correlationId,
        }
      : {
          message: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.",
          errorCode: "UNEXPECTED",
          correlationId: null,
        };

    recordOperation({
      operationKey: request.operationKey,
      kind: request.kind,
      outcome: "REFUSED",
      assignmentId: request.assignmentId,
      disputeId: request.disputeId,
      actor,
      beneficiary,
      amountText: null,
      reason,
      errorCode: failure.errorCode,
      message: failure.message,
      correlationId: failure.correlationId,
      at: new Date().toISOString(),
    });

    return {
      status: "REFUSED",
      message: failure.message,
      errorCode: failure.errorCode,
      correlationId: failure.correlationId,
      amountText: null,
      deduplicated: false,
    };
  }
}

interface ConfirmationCheck {
  /** Set when the check failed; the caller returns it untouched. */
  readonly outcome: EscrowOperationOutcome | null;
  readonly partyName: string | null;
}

/**
 * Prove that the operator confirmed the amount the backend holds *right now*.
 *
 * The submitted figure is compared and then discarded. It is never forwarded:
 * release sends no body at all, and refund deliberately sends no `amount`, so
 * there is no path by which a number from the browser could become the number
 * that moves.
 */
async function confirmAmount(
  accessToken: string,
  request: EscrowOperationRequest,
  direction: EscrowDirection,
): Promise<ConfirmationCheck> {
  let summary: EscrowSummary;

  try {
    summary = await getEscrowSummary(accessToken, request.assignmentId);
  } catch (error) {
    const detail = isKoalaApiError(error) ? error.message : String(error);
    return {
      partyName: null,
      outcome: blocked(
        `Tutar sunucudan doğrulanamadığı için para hareketi yapılmadı: ${detail}`,
        isKoalaApiError(error) ? error.errorCode : "UNEXPECTED",
      ),
    };
  }

  const figure = escrowFigure(summary, direction);

  if (figure.amount === null) {
    return {
      partyName: figure.partyName,
      outcome: blocked(
        "Backend bu hareket için bir tutar vermedi. Panel tutar uydurmaz, bu yüzden işlem yapılmadı.",
        "AMOUNT_UNAVAILABLE",
      ),
    };
  }

  const confirmed: Money = request.confirmedAmount ?? "";

  if (!sameMoney(figure.amount, confirmed)) {
    return {
      partyName: figure.partyName,
      outcome: blocked(
        `Onayladığınız tutar (${normaliseMoney(confirmed)}) sunucudaki tutarla (${normaliseMoney(figure.amount)}) aynı değil. Ekran eskimiş olabilir; sayfayı yenileyip yeniden onaylayın.`,
        "AMOUNT_CHANGED",
      ),
    };
  }

  return { outcome: null, partyName: figure.partyName };
}

interface SuccessDetail {
  readonly message: string;
  readonly amountText: string | null;
  readonly correlationId: string | null;
}

async function send(
  accessToken: string,
  request: EscrowOperationRequest,
  reason: string,
): Promise<SuccessDetail> {
  switch (request.kind) {
    case "RELEASE": {
      const payout = await releaseEscrow(accessToken, request.assignmentId);
      return {
        message: `Çıkış kaydı oluşturuldu (durum: ${payout.status}).`,
        // The backend's own figure, not the one that was confirmed.
        amountText: payout.amount === null ? null : formatCurrency(payout.amount, payout.currency),
        correlationId: null,
      };
    }

    case "REFUND": {
      const meta = await refundEmployer(accessToken, request.assignmentId, reason);
      return {
        message: meta.message ?? "İade kaydı oluşturuldu.",
        // `SuccessResult` carries no data. Left null rather than filled in from
        // the panel's read: this field means "what the backend said it moved".
        amountText: null,
        correlationId: meta.correlationId,
      };
    }

    case "RESOLVE_DISPUTE": {
      const resolution = request.resolution;
      /* v8 ignore next 3 -- validate() has already rejected a null resolution. */
      if (resolution === null) {
        throw new Error("Karar yok.");
      }

      const dispute = await resolveDispute(accessToken, request.disputeId ?? "", {
        resolution,
        note: reason,
      });

      return {
        message: `Uyuşmazlık ${disputeResolutionSpec(resolution).label.toLocaleLowerCase("tr-TR")} kararıyla kapatıldı (durum: ${dispute.status}).`,
        amountText: null,
        correlationId: null,
      };
    }
  }
}
