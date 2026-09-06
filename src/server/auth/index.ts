import "server-only";

import NextAuth from "next-auth";

import { authConfig } from "./config";

/**
 * The single Auth.js instance.
 *
 * `auth` is the server-side session reader (React Server Components, Route
 * Handlers, Server Actions, and the proxy). `handlers` is mounted at
 * `/api/auth/[...nextauth]`. `signIn` / `signOut` are the server-side halves of
 * the two buttons the panel has.
 *
 * Everything here is server-only. There is no `SessionProvider`, no
 * `useSession`, and no client-side auth surface at all — the panel's identity
 * never has a reason to exist in browser JavaScript.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(authConfig);

export { SESSION_COOKIE_NAME } from "./config";
