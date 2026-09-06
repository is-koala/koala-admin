import "server-only";

import type { NextAuthConfig } from "next-auth";
import type { JWT } from "next-auth/jwt";
import Keycloak from "next-auth/providers/keycloak";

import { env } from "@/env";

import { hasAudience, readRealmRoles } from "./claims";
import { buildSessionCookie } from "./cookies";
import { refreshAccessToken, type RefreshedTokens } from "./refresh";
import "./types";

/**
 * Identity, and only identity.
 *
 * ADR-0010 splits the two questions: Keycloak answers *who is this*, Koala
 * answers *what may they do*. This file therefore contains no permission logic
 * and no role checks — it collects the realm roles into the session and stops.
 * Route protection is #5's, and it asks the backend.
 *
 * Two shapes of state must not be confused, and `./types.ts` declares both: the
 * `JWT` carries the Keycloak tokens and stays on the server; the `Session`
 * carries an identity and role names and is what the browser may see. The
 * `session` callback below is the wall between them.
 */

/**
 * Refresh this long before the access token actually expires.
 *
 * Access tokens live 5 minutes by realm policy (`docs/keycloak-setup.md` §2),
 * deliberately short so that revoking a role takes effect quickly. Sixty
 * seconds of margin covers clock skew between the panel and Keycloak and the
 * time a slow backend call spends holding a token it fetched at the start.
 */
const REFRESH_SKEW_MS = 60_000;

const sessionCookie = buildSessionCookie(env.AUTH_URL);

export const SESSION_COOKIE_NAME = sessionCookie.name;

/** Realm policy: SSO Session Max is 8 hours, so the cookie has no business outliving it. */
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export const authConfig: NextAuthConfig = {
  // `AUTH_URL` is validated in src/env.ts and is what both Keycloak's redirect
  // allow-list and the post-logout return address are compared against.
  trustHost: true,

  providers: [
    Keycloak({
      issuer: env.KEYCLOAK_ISSUER,
      clientId: env.KEYCLOAK_CLIENT_ID,
      // Confidential client. The secret is a server-side environment variable
      // and reaches no `NEXT_PUBLIC_*`, no browser bundle, no tracked file.
      clientSecret: env.KEYCLOAK_CLIENT_SECRET,
      /**
       * Spelled out, not inherited. Authorization Code + PKCE is the only flow
       * the panel performs; the realm has direct access grants and implicit
       * switched off, and this is the panel's half of that agreement.
       */
      checks: ["pkce", "state"],
      authorization: { params: { scope: "openid profile email" } },
    }),
  ],

  session: {
    // No database in this slice, so the session lives in the cookie — encrypted
    // with AUTH_SECRET, not merely signed.
    strategy: "jwt",
    maxAge: SESSION_MAX_AGE_SECONDS,
  },

  cookies: { sessionToken: sessionCookie },

  pages: {
    signIn: "/giris",
    signOut: "/giris",
    error: "/giris/hata",
  },

  callbacks: {
    /**
     * Runs on sign-in and on every session read — including the one the proxy
     * performs, which is the only place able to write the rotated cookie back.
     */
    async jwt({ token, account }) {
      // Sign-in: `account` carries the token set from the code exchange.
      if (account) {
        if (typeof account.access_token !== "string" || typeof account.refresh_token !== "string") {
          // Keycloak always sends both for this flow. If it did not, there is
          // no session to build and pretending otherwise buys a broken one.
          return null;
        }

        return applyTokens(token, {
          accessToken: account.access_token,
          refreshToken: account.refresh_token,
          idToken: typeof account.id_token === "string" ? account.id_token : null,
          // Auth.js normalises `expires_in` to `expires_at` in **seconds**.
          expiresAt:
            typeof account.expires_at === "number"
              ? account.expires_at * 1000
              : Date.now() + 300_000,
        });
      }

      // No refresh token means nothing can be renewed and there is no honest
      // way to continue. Returning null clears the cookie.
      if (typeof token.refreshToken !== "string" || token.refreshToken.length === 0) {
        return null;
      }

      const expiresAt = token.accessTokenExpiresAt;
      const stillFresh =
        typeof token.accessToken === "string" &&
        typeof expiresAt === "number" &&
        expiresAt - REFRESH_SKEW_MS > Date.now();

      /**
       * Note what is deliberately *not* in this condition: `authError`.
       *
       * `AUDIENCE_MISCONFIGURED` describes a realm mapper, not a stale token —
       * refreshing cannot fix it. Retrying on every request would spend a
       * rotated refresh token several times a second, and Keycloak answers
       * that by revoking the session. So a misconfigured token is left alone
       * until it expires on its own, and the check is re-run then.
       *
       * `KEYCLOAK_UNREACHABLE` needs no special case: it clears `accessToken`,
       * so `stillFresh` is already false and the next request retries.
       */
      if (stillFresh) {
        return token;
      }

      const outcome = await refreshAccessToken(token.refreshToken, token.idToken ?? null);

      switch (outcome.status) {
        case "refreshed":
          return applyTokens(token, outcome.tokens);

        case "rejected":
          // Keycloak has spoken: this session is over. Drop it rather than
          // leave a cookie that looks like a session and buys nothing — the
          // proxy then sends the person to the login page.
          return null;

        case "unreachable":
          /**
           * Keycloak did not answer. The session may well still be valid, so
           * the refresh token is worth keeping — but the access token is past
           * its life and must not be used, so it goes. The result is a session
           * that cannot act and says why, which is the opposite of quietly
           * carrying on with a stale token.
           */
          return {
            ...token,
            accessToken: undefined,
            authError: "KEYCLOAK_UNREACHABLE" as const,
          };
      }
    },

    /**
     * The wall.
     *
     * Everything the browser learns about the session is built here, field by
     * field, from a whitelist. `token` holds the access, refresh and id tokens;
     * none of them are copied across, and nothing is spread from `token` that
     * could carry one along by accident.
     */
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: typeof token.sub === "string" ? token.sub : "",
          name: typeof token.name === "string" ? token.name : null,
          email: typeof token.email === "string" ? token.email : "",
        },
        roles: token.roles ?? [],
        authError: token.authError ?? null,
      };
    },
  },
};

/**
 * Fold a fresh token set into the JWT, and check the one thing the panel can
 * check about it.
 *
 * The audience check happens here, at the moment the token arrives, rather than
 * after the backend rejects it. A token without `aud: koala-api` produces a 401
 * from the backend, and a 401 is also what "your token is no good" looks like —
 * so a panel that waits for the backend cannot tell a switched-off mapper from
 * a permission problem, and will tell an `OWNER` they lack permission.
 */
function applyTokens(token: JWT, tokens: RefreshedTokens): JWT {
  const audienceOk = hasAudience(tokens.accessToken, env.KOALA_API_AUDIENCE);

  return {
    ...token,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    idToken: tokens.idToken ?? undefined,
    accessTokenExpiresAt: tokens.expiresAt,
    roles: readRealmRoles(tokens.accessToken),
    authError: audienceOk ? undefined : ("AUDIENCE_MISCONFIGURED" as const),
  };
}
