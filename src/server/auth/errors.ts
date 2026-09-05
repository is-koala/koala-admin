/**
 * Why the panel could not put a usable staff identity behind a request.
 *
 * These are deliberately not collapsed into one "auth failed". Three of them
 * look identical to a user and mean completely different things to whoever has
 * to fix them:
 *
 *  - `SESSION_REQUIRED` / `SESSION_EXPIRED` — sign in again. Nothing is broken.
 *  - `AUDIENCE_MISCONFIGURED` — the person is who they say they are and the
 *    realm is wrong. The backend answers 401 for this, which is the same status
 *    it uses for "your token is no good", so the panel must decide this itself
 *    rather than repeat the backend's verdict. Telling a `OWNER` "you lack
 *    permission" when a mapper is switched off sends them hunting in the wrong
 *    place.
 *  - `KEYCLOAK_UNREACHABLE` — nobody can sign in at all. ADR-0010 accepts this
 *    consequence explicitly; the panel's job is to say so instead of returning
 *    a 500.
 */
export const AUTH_FAILURE_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "KEYCLOAK_UNREACHABLE",
  "AUDIENCE_MISCONFIGURED",
  "ACCESS_DENIED",
  "UNKNOWN",
] as const;

export type AuthFailureCode = (typeof AUTH_FAILURE_CODES)[number];

export function isAuthFailureCode(value: unknown): value is AuthFailureCode {
  return typeof value === "string" && (AUTH_FAILURE_CODES as readonly string[]).includes(value);
}

/**
 * Thrown by the server-side session accessors when a request cannot be given a
 * staff identity. Carries the code rather than a rendered message, so a Server
 * Component decides what the person sees and the log keeps the machine-readable
 * reason.
 */
export class StaffAuthError extends Error {
  override readonly name = "StaffAuthError";

  constructor(
    readonly code: AuthFailureCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
  }
}

export function isStaffAuthError(value: unknown): value is StaffAuthError {
  return value instanceof StaffAuthError;
}

/**
 * Auth.js reports its own failures as `?error=` on the page named by
 * `pages.error`. Those codes are its vocabulary, not ours, and the one that
 * matters most is misleadingly named: `Configuration` is what a failed OIDC
 * discovery arrives as — i.e. "Keycloak did not answer".
 *
 * @see https://authjs.dev/reference/core/errors
 */
export function fromAuthjsErrorCode(value: string | undefined | null): AuthFailureCode {
  switch (value) {
    case "Configuration":
      return "KEYCLOAK_UNREACHABLE";
    case "AccessDenied":
      return "ACCESS_DENIED";
    case null:
    case undefined:
    case "":
      return "SESSION_REQUIRED";
    default:
      return isAuthFailureCode(value) ? value : "UNKNOWN";
  }
}
