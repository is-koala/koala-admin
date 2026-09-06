/**
 * The session cookie, spelled out rather than left to a default.
 *
 * Auth.js would derive all of this on its own. It is written down here for two
 * reasons that are not style:
 *
 *  1. The cookie carries the Keycloak tokens (encrypted). `httpOnly` is what
 *     keeps an XSS from reading them, and the panel's permission set reaches
 *     `payout.release`. A default is not something you can point at in a
 *     review; `cookies.test.ts` asserts these three flags.
 *  2. The cookie's **name is the JWE salt**. `session.ts` decrypts the cookie
 *     itself to hand the access token to the server-side Koala client, and it
 *     has to derive the same key Auth.js used. One definition, two readers.
 */

/** Base name; chunks append `.0`, `.1`, … when the value exceeds ~4 KB. */
const BASE_NAME = "authjs.session-token";

export interface SessionCookieDefinition {
  readonly name: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: "lax";
    readonly path: "/";
    readonly secure: boolean;
  };
}

/**
 * `secure` follows the panel's own scheme, and it has to.
 *
 * A `Secure` cookie is simply not stored by the browser over plain HTTP, so
 * hard-coding `true` would not harden development — it would make local sign-in
 * impossible and push someone to turn the whole thing off. `AUTH_URL` is
 * validated in `src/env.ts` to be HTTPS anywhere but localhost, so `https`
 * in production is not a hope: an `http://admin.iskoala.com` never boots.
 *
 * `sameSite: "lax"` is the setting the OIDC redirect needs. `strict` would drop
 * the cookie on the top-level navigation back from Keycloak and loop the login.
 */
export function buildSessionCookie(authUrl: string): SessionCookieDefinition {
  const secure = authUrl.startsWith("https:");

  return {
    // `__Secure-` is only legal on a secure cookie, and Auth.js applies the
    // same prefix rule — the names have to agree or the cookie is written under
    // one name and read under another.
    name: secure ? `__Secure-${BASE_NAME}` : BASE_NAME,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
    },
  };
}

/**
 * Reassemble a chunked session cookie.
 *
 * A Keycloak token set — access + refresh + id — is comfortably over the 4 KB a
 * cookie may hold, so Auth.js splits the encrypted value across
 * `authjs.session-token.0`, `.1`, … Anything reading the cookie directly has to
 * put it back together in the same order, or it decrypts nothing.
 *
 * Mirrors `SessionStore` in `@auth/core/lib/utils/cookie`: every cookie whose
 * name starts with the base name, ordered by the numeric suffix.
 */
export function joinSessionCookieChunks(
  cookies: readonly { readonly name: string; readonly value: string }[],
  cookieName: string,
): string | null {
  const chunks = cookies.filter(
    (cookie) => cookie.name.startsWith(cookieName) && cookie.value.length > 0,
  );

  if (chunks.length === 0) return null;

  return chunks
    .slice()
    .sort((a, b) => suffixIndex(a.name) - suffixIndex(b.name))
    .map((cookie) => cookie.value)
    .join("");
}

function suffixIndex(name: string): number {
  const suffix = Number.parseInt(name.split(".").pop() ?? "0", 10);
  return Number.isNaN(suffix) ? 0 : suffix;
}
