import { NextResponse } from "next/server";

import { auth } from "@/server/auth";

/**
 * The session gate. Every request to the panel passes through here.
 *
 * Two jobs, and the second one is easy to miss. The obvious job is turning
 * anonymous requests away. The other is that **this is the only place a
 * refreshed session cookie can be written**: Auth.js rotates the token inside
 * the `jwt` callback that `auth()` runs, and writes the result as a `Set-Cookie`
 * on this response. A Server Component has no response to write to, so without
 * this file every request would keep presenting the same expiring cookie.
 *
 * Wrapped in `auth(...)` rather than reading the cookie by hand for exactly
 * that reason — the wrapper copies the session response's cookies onto ours.
 *
 * It runs in the Node.js runtime (Next.js 16's default for `proxy.ts`), which
 * matters: `src/server/auth/refresh.ts` de-duplicates refreshes through a map on
 * `globalThis`, and an Edge isolate would not share it with the server render
 * happening right behind this request.
 */

/**
 * Reachable without a session, and each one has to earn it:
 *
 *  - `/giris` and `/giris/hata` are the sign-in surfaces. Gating them would
 *    loop the redirect and hide every error message behind the error it is
 *    trying to report.
 *
 * `/api/auth/*` (where sessions come from) and `/api/health` (which a load
 * balancer calls without a cookie) never reach this function at all — they are
 * excluded by the matcher below.
 */
const PUBLIC_PATHS: readonly string[] = ["/giris", "/giris/hata"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export default auth((request) => {
  const { pathname, search } = request.nextUrl;
  const session = request.auth;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  if (session === null) {
    // No session, or one Auth.js just dropped because its refresh token was
    // rejected. Either way the cookie is already being cleared on this
    // response, so nobody is left half signed in.
    const signIn = new URL("/giris", request.nextUrl.origin);
    signIn.searchParams.set("callbackUrl", `${pathname}${search}`);
    return NextResponse.redirect(signIn);
  }

  if (session.authError !== null) {
    // Signed in, but the token cannot be used — a realm mapper is off, or
    // Keycloak stopped answering. Both are configuration failures and neither
    // is "you lack permission", so they get their own page and their own words.
    const error = new URL("/giris/hata", request.nextUrl.origin);
    error.searchParams.set("kod", session.authError);
    return NextResponse.redirect(error);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    /**
     * Everything except:
     *  - `api/auth/*`   — Auth.js's own endpoints; a session gate in front of
     *                     the thing that issues sessions is a locked door with
     *                     the key inside.
     *  - `api/health`   — the liveness probe, called without a cookie.
     *  - Next.js build output and the favicon, which carry nothing to protect
     *    and would otherwise run a session read per asset.
     */
    "/((?!api/auth|api/health|_next/static|_next/image|favicon.ico).*)",
  ],
};
