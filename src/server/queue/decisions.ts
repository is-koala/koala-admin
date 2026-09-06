import "server-only";

import {
  decisionFailed,
  decisionRejected,
  type DecisionState,
} from "@/components/panel/queue/decision-state";
import type { QueueFailure } from "@/components/panel/queue/load-failure";
import { isKoalaApiError } from "@/server/api/errors";
import { permissionLabel, type Permission } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";

/**
 * The server half of the shared queue pattern: how a load fails, and what a
 * Server Action is allowed to do.
 *
 * {@link guardDecision} is the part that is easy to leave out and expensive to
 * leave out. `<RequirePermission>` protects a *page*; a Server Action is its
 * own POST endpoint with its own URL, reachable by anyone who can reach the
 * app, and the gate on the page that happened to render the form protects it
 * exactly as much as a hidden `<div>` protects data. So every decision action
 * re-resolves the caller's permissions before it does anything.
 *
 * This is still not the authority. `@RequiresPermission` on the backend is —
 * `report.review` and `company.approve` are enforced there and would refuse the
 * call regardless. The guard exists so a refusal is a sentence rather than a
 * 403 the operator has to interpret, and so the panel does not spend a mutating
 * request finding out something it already knows.
 */

/** Turn anything thrown by a queue fetch into something a screen can render. */
export function classifyQueueFailure(error: unknown): QueueFailure {
  if (isKoalaApiError(error)) {
    if (error.isForbidden) {
      return {
        kind: "forbidden",
        errorCode: error.errorCode,
        correlationId: error.correlationId,
      };
    }

    return {
      kind: "error",
      message: error.message,
      errorCode: error.errorCode,
      correlationId: error.correlationId,
    };
  }

  return {
    kind: "error",
    message: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.",
    errorCode: null,
    correlationId: null,
  };
}

/**
 * Resolve the caller's permissions and refuse if they do not hold this one.
 *
 * Returns `null` when the action may proceed, and a ready-to-return
 * {@link DecisionState} when it may not — so the call site reads as
 * `const denied = await guardDecision(...); if (denied) return denied;` and
 * cannot forget to act on the answer the way a thrown-away boolean can.
 *
 * Fail-closed comes from `getStaffContext()`: any failure there produces an
 * empty permission list, so an unreachable backend refuses the decision rather
 * than waving it through.
 */
export async function guardDecision(permission: Permission): Promise<DecisionState | null> {
  const context = await getStaffContext();

  if (context.failure !== null) {
    return decisionFailed(
      "İzinleriniz çözülemediği için karar gönderilmedi. Panel emin olmadığı hiçbir işlemi yapmaz; birkaç dakika sonra tekrar deneyin.",
      context.failure.kind,
      context.failure.correlationId,
    );
  }

  if (!context.has(permission)) {
    return decisionRejected(
      `Bu karar "${permissionLabel(permission)}" iznini gerektiriyor ve hesabınızda bu izin yok. Rol üyeliği Keycloak konsolunda, rolün izinleri Koala'da tanımlıdır.`,
    );
  }

  return null;
}

/**
 * A backend refusal, as a form message.
 *
 * `409` is called out by name because both endpoints use it for the same
 * situation and it is the one an operator will actually hit: a report someone
 * else already reviewed (`ReportManager.review`), or a company someone else
 * already approved (`CompanyManager.approveCompany`). "Conflict" is not a
 * failure to retry — the work is done — and saying so stops a second operator
 * hammering the button.
 */
export function decisionFailureFrom(error: unknown, fallbackTitle: string): DecisionState {
  if (isKoalaApiError(error)) {
    if (error.status === 409) {
      return decisionFailed(
        `${error.message} Bu kayıt sizden önce sonuçlandırılmış olabilir; listeyi yenileyin.`,
        error.errorCode,
        error.correlationId,
      );
    }

    if (error.isForbidden) {
      return decisionFailed(
        `Backend bu kararı reddetti: ${error.message} Yetki kararını backend verir.`,
        error.errorCode,
        error.correlationId,
      );
    }

    return decisionFailed(error.message, error.errorCode, error.correlationId);
  }

  return decisionFailed(error instanceof Error ? error.message : fallbackTitle, null, null);
}
