import "server-only";

import { cache } from "react";

import { isKoalaApiError } from "@/server/api/errors";
import { isStaffAuthError, type AuthFailureCode } from "@/server/auth/errors";
import { backendSaysPasswordMustChange, getKoalaAccessToken } from "@/server/auth/session";

import { fetchAdminMe, type StaffIdentity } from "./me";
import type { Permission } from "./permissions";

/**
 * Who is asking, and what may they do — resolved from the backend, on every
 * request, and stored nowhere.
 *
 * ADR-0010's rule, restated as code and carried over verbatim by ADR-0014:
 * permissions are not in the access token and not in the session cookie.
 * `src/server/auth/*` knows how to prove who is calling and nothing about what
 * they may do; this module asks Koala and forgets the answer when the render
 * ends.
 *
 * Three properties, and each one is load-bearing:
 *
 *  - **Per request.** `GET /admin/me` is called with `cache: "no-store"`. There
 *    is no cookie field, no `unstable_cache`, no module-level memo that
 *    outlives a render. A revoked `payout.release` stops working on
 *    the next page view rather than when a token expires.
 *  - **De-duplicated within one render.** React's `cache()` keyed on the render
 *    means the panel layout drawing the menu and the page gating itself share
 *    one call. The cache lives exactly as long as the request does.
 *  - **Fail closed.** Every failure — no session, no staff record, a backend
 *    500, a response that does not match the contract —
 *    produces an *empty* permission list and a reason. Nothing in this module
 *    can return a partial list: there is one assignment of `permissions`, and
 *    the failure paths never reach it.
 */

/**
 * Why the panel could not resolve permissions. The distinction matters because
 * the person reading the screen has to know whether to sign in again, call an
 * administrator, or wait.
 */
export type StaffContextFailureKind =
  /** Token accepted, `/admin/me` refused: no staff row, or an inactive account. */
  | "NO_STAFF_RECORD"
  /** The session itself is the problem; `authCode` says which one. */
  | "SESSION"
  /** The backend answered, badly — 5xx, a timeout, a body that is not the contract. */
  | "BACKEND_UNAVAILABLE"
  /** Anything else, so that "unexpected" never silently becomes "allowed". */
  | "UNEXPECTED";

export interface StaffContextFailure {
  readonly kind: StaffContextFailureKind;
  /**
   * Set only for `kind: "SESSION"`. The panel already has a page for each of
   * these codes (`/giris`, `/giris/hata`); callers route to it rather than
   * inventing new words.
   */
  readonly authCode: AuthFailureCode | null;
  /** HTTP status, when there was a response. `0` for a transport failure. */
  readonly status: number | null;
  /** The backend's request id — the only handle on the matching log line. */
  readonly requestId: string | null;
  /** Diagnostic detail, for the log and for an operator who can act on it. */
  readonly detail: string;
}

export interface StaffContext {
  /** Identity as the *backend* knows it, or `null` when it could not be resolved. */
  readonly staff: StaffIdentity | null;
  /** Effective permissions. Empty whenever {@link failure} is set — always. */
  readonly permissions: readonly Permission[];
  readonly failure: StaffContextFailure | null;
  has(permission: Permission): boolean;
}

/**
 * The context for this request.
 *
 * `cache()` is React's request-scoped memo: the first caller in a render pays
 * for the round trip and everyone else in the same render gets the same
 * promise. It is *not* a cache in the ordinary sense — nothing survives the
 * response — which is why it is the only memoisation ADR-0010 leaves room for.
 *
 * Never throws. A page that wants to redirect on a broken session reads
 * `failure.authCode` and decides for itself.
 */
export const getStaffContext: () => Promise<StaffContext> = cache(loadStaffContext);

/**
 * The uncached implementation. Exported so tests can exercise it without
 * standing up a React render, and so the cache wrapper above is the only thing
 * anyone has to trust about scoping.
 */
export async function loadStaffContext(): Promise<StaffContext> {
  try {
    const accessToken = await getKoalaAccessToken();
    return granted(await fetchAdminMe(accessToken));
  } catch (error) {
    return denied(await toFailure(error));
  }
}

function granted(staff: StaffIdentity): StaffContext {
  const permissions = staff.permissions;
  return {
    staff,
    permissions,
    failure: null,
    has: (permission) => permissions.includes(permission),
  };
}

/**
 * The fail-closed constructor. Note there is no `permissions` parameter: a
 * failure cannot carry a partial list even by accident.
 */
function denied(failure: StaffContextFailure): StaffContext {
  return {
    staff: null,
    permissions: [],
    failure,
    has: () => false,
  };
}

async function toFailure(error: unknown): Promise<StaffContextFailure> {
  if (isStaffAuthError(error)) {
    return {
      kind: "SESSION",
      authCode: error.code,
      status: null,
      requestId: null,
      detail: error.message,
    };
  }

  if (isKoalaApiError(error)) {
    /**
     * 403 from `/admin/me` has **two** causes and they need opposite screens.
     *
     * One is about the person: the token was accepted and the account still
     * resolved to nothing usable — no staff row, or an account switched off.
     * Nobody but an administrator can fix that.
     *
     * The other is the "change your password first" flag, which
     * `StaffPermissionAuthorizationManager` answers with the same 403 on every
     * `@RequiresPermission` endpoint, this one included. That one the person
     * fixes themselves, in one step, on a screen that already exists — and
     * being told "the backend gave you no staff record" instead would send
     * someone who is two clicks from working to ask a colleague for roles they
     * already hold.
     *
     * `getKoalaAccessToken()` catches the second cause first *when it can*, but
     * it reads the flag off an unsigned cookie: a `false` written there by hand
     * walks straight past it. So the backend gets asked, and only on this path —
     * the person is already looking at an error screen, and an extra round trip
     * buys the difference between the right screen and the wrong one.
     */
    if (error.status === 403 || error.errorCategory === "ACCESS_DENIED") {
      if (await backendSaysPasswordMustChange()) {
        return {
          kind: "SESSION",
          authCode: "PASSWORD_CHANGE_REQUIRED",
          status: error.status,
          requestId: error.requestId,
          detail: `Backend /admin/me'yi reddetti ve parola değiştirme bayrağını açık bildirdi: ${error.message}`,
        };
      }

      return {
        kind: "NO_STAFF_RECORD",
        authCode: null,
        status: error.status,
        requestId: error.requestId,
        detail: error.message,
      };
    }

    /**
     * 401 here means the backend rejected a token the panel had just refreshed.
     * The usual cause is the token version moving underneath us — a logout
     * elsewhere, a password change, an account switched off — and all three end
     * the session. Emphatically not "you lack permission": saying that would
     * send an OWNER hunting for missing roles.
     */
    if (error.isAuthFailure) {
      return {
        kind: "SESSION",
        authCode: "SESSION_EXPIRED",
        status: error.status,
        requestId: error.requestId,
        detail: error.message,
      };
    }

    return {
      kind: "BACKEND_UNAVAILABLE",
      authCode: null,
      status: error.status,
      requestId: error.requestId,
      detail: error.message,
    };
  }

  return {
    kind: "UNEXPECTED",
    authCode: null,
    status: null,
    requestId: null,
    detail: error instanceof Error ? error.message : String(error),
  };
}
