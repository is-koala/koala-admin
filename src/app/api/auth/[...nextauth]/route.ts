import { handlers } from "@/server/auth";

/**
 * Auth.js's own endpoints: the sign-in redirect, the OAuth callback, the CSRF
 * token, and `/api/auth/session`.
 *
 * This is the one path `src/proxy.ts` lets through without a session — it has
 * to, since it is where a session comes from.
 *
 * `/api/auth/session` is the only auth surface the browser can reach, and what
 * it returns is built by the `session` callback in `src/server/auth/config.ts`
 * from a whitelist. `session-shape.test.ts` asserts no token is in it.
 */
export const { GET, POST } = handlers;
