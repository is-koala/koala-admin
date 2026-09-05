import type { AuthFailureCode } from "./errors";

/**
 * What the panel keeps in the encrypted session cookie, and what it lets out.
 *
 * The split is the point of this file. `JWT` holds the Keycloak tokens and
 * never leaves the server. `Session` — the thing `auth()` returns and the thing
 * `/api/auth/session` serialises to the browser — holds an identity and a list
 * of role names, and no token of any kind.
 *
 * Written as a type augmentation rather than a comment so that putting
 * `accessToken` on the session becomes a change someone has to make on purpose,
 * in this file, directly under the sentence saying not to.
 */

declare module "next-auth/jwt" {
  /** Server-side only. Encrypted into the session cookie, never serialised out. */
  interface JWT {
    accessToken?: string;
    refreshToken?: string;
    idToken?: string;
    /**
     * Epoch **milliseconds**. Auth.js hands `account.expires_at` over in
     * seconds; it is converted on the way in, and the name says which unit
     * this one is so the two never get mixed up.
     */
    accessTokenExpiresAt?: number;
    /** Realm roles, already flattened by Keycloak from the composite hierarchy. */
    roles?: readonly string[];
    /** Set when the token is unusable but the session is not necessarily over. */
    authError?: AuthFailureCode;
  }
}

declare module "next-auth" {
  /**
   * Everything the client may know. Note what is absent, and keep it absent:
   * no `accessToken`, no `refreshToken`, no `idToken`.
   */
  interface Session {
    roles: readonly string[];
    /** Surfaced so the proxy can route a broken session to the right page. */
    authError: AuthFailureCode | null;
  }
}
