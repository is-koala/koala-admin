import "server-only";

import { cache } from "react";

import { isKoalaApiError } from "@/server/api/errors";
import { isStaffAuthError, type AuthFailureCode } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";

import { fetchAdminMe, type StaffIdentity } from "./me";
import type { Permission } from "./permissions";

/**
 * Who is asking, and what may they do — resolved from the backend, on every
 * request, and stored nowhere.
 *
 * ADR-0010's rule, restated as code: permissions are not in the access token
 * and not in the session. `src/server/auth/*` knows Keycloak's role membership
 * and nothing about what a role permits; this module asks Koala and forgets the
 * answer when the render ends.
 *
 * Three properties, and each one is load-bearing:
 *
 *  - **Per request.** `GET /admin/me` is called with `cache: "no-store"`. There
 *    is no cookie, no NextAuth JWT field, no `unstable_cache`, no module-level
 *    memo that outlives a render. A revoked `payout.release` stops working on
 *    the next page view rather than when a token expires.
 *  - **De-duplicated within one render.** React's `cache()` keyed on the render
 *    means the panel layout drawing the menu and the page gating itself share
 *    one call. The cache lives exactly as long as the request does.
 *  - **Fail closed.** Every failure — no session, Keycloak down, no staff
 *    record, a backend 500, a response that does not match the contract —
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
  /** Valid Keycloak identity, no `staff_members` row. Normal during migration. */
  | "NO_STAFF_RECORD"
  /** The session itself is the problem; `authCode` says which of the four. */
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
  /** The backend's correlation id — the only handle on the matching log line. */
  readonly correlationId: string | null;
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
    return denied(toFailure(error));
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

function toFailure(error: unknown): StaffContextFailure {
  if (isStaffAuthError(error)) {
    return {
      kind: "SESSION",
      authCode: error.code,
      status: null,
      correlationId: null,
      detail: error.message,
    };
  }

  if (isKoalaApiError(error)) {
    /**
     * 403 from `/admin/me` is the one failure that is about the *person* rather
     * than the machinery: Keycloak vouched for them and Koala has no staff row.
     * koala-admin#5's first comment calls this the normal state of the
     * migration window, so it gets its own kind and its own screen.
     */
    if (error.status === 403 || error.errorCategory === "ACCESS_DENIED") {
      return {
        kind: "NO_STAFF_RECORD",
        authCode: null,
        status: error.status,
        correlationId: error.correlationId,
        detail: error.message,
      };
    }

    /**
     * 401 here means the backend rejected a token the panel had already checked
     * the audience of. That is a configuration problem on one side or the
     * other, and it is emphatically not "you lack permission" — saying so would
     * send an OWNER hunting for missing roles.
     */
    if (error.isAuthFailure) {
      return {
        kind: "SESSION",
        authCode: "SESSION_EXPIRED",
        status: error.status,
        correlationId: error.correlationId,
        detail: error.message,
      };
    }

    return {
      kind: "BACKEND_UNAVAILABLE",
      authCode: null,
      status: error.status,
      correlationId: error.correlationId,
      detail: error.message,
    };
  }

  return {
    kind: "UNEXPECTED",
    authCode: null,
    status: null,
    correlationId: null,
    detail: error instanceof Error ? error.message : String(error),
  };
}
