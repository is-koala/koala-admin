import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "next-auth";
import { decode, type JWT } from "next-auth/jwt";

import { env } from "@/env";

import { hasAudience } from "./claims";
import { SESSION_COOKIE_NAME } from "./config";
import { joinSessionCookieChunks } from "./cookies";
import { StaffAuthError } from "./errors";
import { auth } from "./index";
import { refreshAccessToken } from "./refresh";
import "./types";

/**
 * The server's two ways of asking about the signed-in staff member.
 *
 * {@link getStaffSession} returns the sanitised session — identity and role
 * names, no tokens. Anything rendering a page wants this one.
 *
 * {@link getKoalaAccessToken} returns the access token, and is the *only* way
 * to get one. It is what `src/server/api/koala.ts` expects in its
 * `accessToken` parameter, and #5's server-side `GET /admin/me` is its first
 * real caller:
 *
 * ```ts
 * const me = await koalaApi.get({
 *   path: "/admin/me",
 *   schema: adminMeSchema,
 *   accessToken: await getKoalaAccessToken(),
 * });
 * ```
 *
 * Both are server-only. There is no client-side counterpart, by design.
 */

/** Matches `REFRESH_SKEW_MS` in `config.ts`: don't hand out a token about to die mid-call. */
const REFRESH_SKEW_MS = 60_000;

export async function getStaffSession(): Promise<Session | null> {
  return auth();
}

/**
 * The session, or a redirect. For pages that have nothing to render without an
 * identity.
 *
 * `src/proxy.ts` already turns anonymous requests away, so this is the second
 * lock rather than the first — it catches a route left out of the matcher, and
 * a session that died in the gap between the gate and the render. It redirects
 * instead of throwing so neither case can surface as a 500.
 */
export async function requireStaffSession(): Promise<Session> {
  const session = await getStaffSession();

  if (session === null) {
    redirect("/giris");
  }

  if (session.authError !== null) {
    redirect(`/giris/hata?kod=${encodeURIComponent(session.authError)}`);
  }

  return session;
}

/**
 * Read the JWT out of the session cookie.
 *
 * `auth()` deliberately cannot return the access token — the `session` callback
 * strips it — so this decrypts the cookie itself, with the same secret and the
 * same salt (the cookie name) Auth.js used to write it.
 *
 * The cookie is chunked when a Keycloak token set pushes it past 4 KB, which it
 * routinely does, so the chunks are rejoined first.
 */
async function readStaffJwt(): Promise<JWT | null> {
  const store = await cookies();
  const value = joinSessionCookieChunks(store.getAll(), SESSION_COOKIE_NAME);

  if (value === null) return null;

  const payload = await decode({
    token: value,
    secret: env.AUTH_SECRET,
    // Auth.js derives the encryption key from secret + salt, and uses the
    // cookie name as the salt. Get this wrong and decryption simply returns
    // null, with nothing to say why.
    salt: SESSION_COOKIE_NAME,
  });

  return payload;
}

/**
 * An access token that is valid right now, for a server-side call to the Koala
 * backend.
 *
 * Refreshing here rather than only in the proxy is not belt-and-braces. Auth.js
 * can only write a rotated cookie from a response, and a Server Component has
 * no response to write to — so within a single request the render still sees
 * the pre-refresh cookie. `refreshAccessToken` de-duplicates by refresh token,
 * so this call joins the proxy's refresh instead of spending the same rotated
 * token a second time, which Keycloak would answer by revoking the session.
 *
 * @throws {StaffAuthError} — the code says which of the four things went wrong,
 * and callers need the difference: `SESSION_REQUIRED`/`SESSION_EXPIRED` mean
 * sign in again, `AUDIENCE_MISCONFIGURED` means the realm is wrong and the
 * person is fine, `KEYCLOAK_UNREACHABLE` means nothing will work until it is
 * back.
 */
export async function getKoalaAccessToken(): Promise<string> {
  const token = await readStaffJwt();

  if (token === null) {
    throw new StaffAuthError("SESSION_REQUIRED", "Oturum çerezi yok ya da çözülemedi.");
  }

  if (token.authError === "AUDIENCE_MISCONFIGURED") {
    throw new StaffAuthError(
      "AUDIENCE_MISCONFIGURED",
      `Access token'ın audience değeri "${env.KOALA_API_AUDIENCE}" değil.`,
    );
  }

  const fresh =
    typeof token.accessToken === "string" &&
    typeof token.accessTokenExpiresAt === "number" &&
    token.accessTokenExpiresAt - REFRESH_SKEW_MS > Date.now();

  if (fresh && typeof token.accessToken === "string") {
    return assertAudience(token.accessToken);
  }

  if (typeof token.refreshToken !== "string" || token.refreshToken.length === 0) {
    throw new StaffAuthError("SESSION_EXPIRED", "Yenilenebilecek bir refresh token yok.");
  }

  const outcome = await refreshAccessToken(token.refreshToken, token.idToken ?? null);

  switch (outcome.status) {
    case "refreshed":
      return assertAudience(outcome.tokens.accessToken);
    case "rejected":
      throw new StaffAuthError("SESSION_EXPIRED", `Yenileme reddedildi: ${outcome.reason}`);
    case "unreachable":
      throw new StaffAuthError("KEYCLOAK_UNREACHABLE", `Keycloak yanıt vermedi: ${outcome.reason}`);
  }
}

/**
 * Last gate before a token leaves for the backend.
 *
 * The `jwt` callback already checks this, but that check runs when the token is
 * minted and this one runs when it is spent — and a token can reach here from a
 * cookie written before the mapper was switched off. Without it the backend
 * answers 401 and the panel has no way left to tell a configuration problem
 * from a permission problem.
 */
function assertAudience(accessToken: string): string {
  if (!hasAudience(accessToken, env.KOALA_API_AUDIENCE)) {
    throw new StaffAuthError(
      "AUDIENCE_MISCONFIGURED",
      `Access token'ın audience değeri "${env.KOALA_API_AUDIENCE}" değil.`,
    );
  }

  return accessToken;
}

/**
 * The id token, for RP-initiated logout only.
 *
 * Keycloak needs `id_token_hint` to know *which* SSO session to end. Without it
 * the logout endpoint shows a confirmation screen or does nothing, the local
 * cookie disappears anyway, and the next sign-in comes back without asking for
 * a password — a logout that looks like it worked and did not.
 */
export async function getIdTokenHint(): Promise<string | null> {
  const token = await readStaffJwt();
  return typeof token?.idToken === "string" ? token.idToken : null;
}
