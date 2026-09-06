/**
 * The RP-initiated logout URL.
 *
 * Split out of `actions.ts` and kept pure so it can be tested: a Server Action
 * module may only export async functions, and this is the one part of logging
 * out whose correctness is not obvious from watching it work. Clearing the
 * local cookie always looks successful — the panel forgets you either way — so
 * a logout that silently fails to close the Keycloak SSO session is invisible
 * until someone notices the next sign-in never asks for a password.
 *
 * @see https://openid.net/specs/openid-connect-rpinitiated-1_0.html
 */
export function buildRpInitiatedLogoutUrl(options: {
  /** From the realm's discovery document, never assembled by hand. */
  endSessionEndpoint: string;
  /**
   * Proves *which* session is ending. Without it Keycloak shows a "did you
   * mean to log out?" confirmation instead of just doing it, and an
   * unattended redirect quietly leaves the SSO session open.
   */
  idToken: string;
  /** Where Keycloak sends the browser afterwards; must be on the realm's allow-list. */
  returnTo: string;
}): string {
  const url = new URL(options.endSessionEndpoint);

  url.searchParams.set("id_token_hint", options.idToken);
  url.searchParams.set("post_logout_redirect_uri", options.returnTo);

  return url.toString();
}
