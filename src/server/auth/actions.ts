"use server";

import { redirect, unstable_rethrow } from "next/navigation";

import { env } from "@/env";

import { getKeycloakEndpoints } from "./discovery";
import { signIn, signOut } from "./index";
import { getIdTokenHint } from "./session";

/**
 * The panel's two auth actions. There is no third: no password form, no
 * registration, no password reset, no MFA enrolment. ADR-0010 puts all of that
 * in the Keycloak admin console, and the realm has registration switched off
 * anyway, so a screen here would be a dead end with a Koala logo on it.
 */

/**
 * Hand the browser to Keycloak. Authorization Code + PKCE; the panel never sees
 * a password.
 */
export async function signInWithKeycloak(callbackUrl?: string): Promise<void> {
  try {
    await signIn("keycloak", { redirectTo: safeCallbackUrl(callbackUrl) });
  } catch (error) {
    // `signIn` finishes by throwing the redirect. Anything else is Keycloak
    // failing to answer discovery, which must land on a page that says so
    // rather than a generic 500.
    unstable_rethrow(error);
    redirect("/giris/hata?kod=KEYCLOAK_UNREACHABLE");
  }
}

/**
 * Sign out of the panel **and** of Keycloak.
 *
 * Clearing the local cookie is the easy half and on its own it is a bug: the
 * Keycloak SSO session stays open, so the next "sign in" bounces straight
 * through without asking for a password and the person believes they logged
 * out. The fix is RP-initiated logout — send the browser to the realm's
 * `end_session_endpoint` with `id_token_hint` so Keycloak knows which session
 * to end.
 *
 * Order matters: read the id token first (it lives in the cookie we are about
 * to delete), then drop the local session, then leave.
 */
export async function signOutFromKeycloak(): Promise<void> {
  const logoutUrl = await buildLogoutUrl();

  // `redirect: false` because the redirect below is ours, not Auth.js's.
  await signOut({ redirect: false });

  // `typedRoutes` narrows `redirect` to this app's own routes. Keycloak's
  // `end_session_endpoint` is by definition not one of them, and it is not a
  // route we made up either — it came from the realm's discovery document.
  redirect((logoutUrl ?? "/giris") as Parameters<typeof redirect>[0]);
}

async function buildLogoutUrl(): Promise<string | null> {
  const idToken = await getIdTokenHint();
  if (idToken === null) return null;

  let endSessionEndpoint: string;
  try {
    ({ endSessionEndpoint } = await getKeycloakEndpoints());
  } catch {
    // Keycloak is unreachable. The local cookie still goes — leaving someone
    // signed in to a panel they asked to leave would be worse — but say so
    // rather than pretend the SSO session is closed.
    return "/giris/hata?kod=KEYCLOAK_UNREACHABLE";
  }

  const url = new URL(endSessionEndpoint);
  url.searchParams.set("id_token_hint", idToken);
  url.searchParams.set("post_logout_redirect_uri", env.AUTH_URL);

  return url.toString();
}

/**
 * Only ever come back to this panel.
 *
 * `callbackUrl` arrives from the query string the proxy wrote, and a query
 * string is user input: an absolute URL here would turn the login page into an
 * open redirect that borrows the panel's credibility.
 */
function safeCallbackUrl(candidate: string | undefined): string {
  if (candidate === undefined || !candidate.startsWith("/") || candidate.startsWith("//")) {
    return "/";
  }

  return candidate;
}
