import { describe, expect, it } from "vitest";

import { buildRpInitiatedLogoutUrl } from "./logout";

const END_SESSION = "http://localhost:8085/realms/koala-staff/protocol/openid-connect/logout";

describe("buildRpInitiatedLogoutUrl", () => {
  it("sends the id token as the hint and names where to come back to", () => {
    // Without `id_token_hint` Keycloak shows a confirmation screen instead of
    // ending the session — and the local cookie is gone either way, so the
    // failure is invisible until the next sign-in walks through without a
    // password.
    const url = new URL(
      buildRpInitiatedLogoutUrl({
        endSessionEndpoint: END_SESSION,
        idToken: "the-id-token",
        returnTo: "https://admin.iskoala.com",
      }),
    );

    expect(url.origin + url.pathname).toBe(END_SESSION);
    expect(url.searchParams.get("id_token_hint")).toBe("the-id-token");
    expect(url.searchParams.get("post_logout_redirect_uri")).toBe("https://admin.iskoala.com");
  });

  it("escapes the return address rather than concatenating it", () => {
    const url = buildRpInitiatedLogoutUrl({
      endSessionEndpoint: END_SESSION,
      idToken: "t",
      returnTo: "https://admin.iskoala.com/?x=1&y=2",
    });

    expect(url).toContain(
      "post_logout_redirect_uri=https%3A%2F%2Fadmin.iskoala.com%2F%3Fx%3D1%26y%3D2",
    );
  });

  it("keeps a query string the discovery document already carried", () => {
    const url = new URL(
      buildRpInitiatedLogoutUrl({
        endSessionEndpoint: `${END_SESSION}?tenant=koala`,
        idToken: "t",
        returnTo: "https://admin.iskoala.com",
      }),
    );

    expect(url.searchParams.get("tenant")).toBe("koala");
    expect(url.searchParams.get("id_token_hint")).toBe("t");
  });
});
