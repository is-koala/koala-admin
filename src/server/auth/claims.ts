/**
 * Reading claims out of a Keycloak access token.
 *
 * Nothing here verifies a signature, and that is correct rather than lazy: the
 * panel is not the resource server. It receives these tokens from Keycloak over
 * TLS on a back channel it opened itself, and forwards them to the Koala
 * backend, which is the party that validates them against the realm's JWKS
 * (koala-backend#14). The panel only reads two things — who is signed in, and
 * whether the token is addressed to the right audience.
 *
 * Pure functions on purpose: `claims.test.ts` can feed them a hand-built token
 * without a Keycloak anywhere.
 */

/** Minimal decoder for the payload segment of a compact JWS. */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const segments = token.split(".");
  const payload = segments[1];
  if (segments.length !== 3 || payload === undefined || payload.length === 0) {
    return null;
  }

  try {
    const base64 = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
    const json = new TextDecoder().decode(Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)));
    const parsed: unknown = JSON.parse(json);

    return typeof parsed === "object" && parsed !== null
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** `aud` is a string or an array of strings (RFC 7519 §4.1.3). */
export function readAudiences(token: string): readonly string[] {
  const aud = decodeJwtPayload(token)?.aud;

  if (typeof aud === "string") return [aud];
  if (Array.isArray(aud)) return aud.filter((value): value is string => typeof value === "string");
  return [];
}

/**
 * Whether the token is addressed to the Koala backend.
 *
 * A `false` here is a realm misconfiguration — the audience mapper in
 * `docs/keycloak-setup.md` §4 is missing or switched off — and never a
 * permission problem. Checking it at the moment the token is issued means the
 * panel can say which it is; waiting for the backend's 401 means it cannot.
 */
export function hasAudience(token: string, audience: string): boolean {
  return readAudiences(token).includes(audience);
}

/**
 * Realm roles, from the `realm_access.roles` claim the realm-role mapper puts
 * in the access token.
 *
 * Composite roles arrive already expanded — signing in as `OWNER` yields every
 * role it contains — because Keycloak flattens them when it mints the token.
 * What a role is *allowed to do* is not here and never will be: ADR-0010 keeps
 * role→permission in Koala, and #5 asks the backend for it.
 */
export function readRealmRoles(token: string): readonly string[] {
  const realmAccess = decodeJwtPayload(token)?.realm_access;
  if (typeof realmAccess !== "object" || realmAccess === null) return [];

  const roles = (realmAccess as Record<string, unknown>).roles;
  if (!Array.isArray(roles)) return [];

  return roles.filter((value): value is string => typeof value === "string");
}

/** `exp` as epoch milliseconds, or `null` when the token carries none. */
export function readExpiryMs(token: string): number | null {
  const exp = decodeJwtPayload(token)?.exp;
  return typeof exp === "number" && Number.isFinite(exp) ? exp * 1000 : null;
}
