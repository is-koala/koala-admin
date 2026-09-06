import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "../../../test/msw";
import { clearDiscoveryCache } from "./discovery";
import { clearRefreshCache, readTokenResponse, refreshAccessToken } from "./refresh";

const ISSUER = "http://localhost:8085/realms/koala-staff";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;

function stubDiscovery(): void {
  server.use(
    http.get(DISCOVERY_URL, () =>
      HttpResponse.json({
        issuer: ISSUER,
        token_endpoint: TOKEN_URL,
        end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
      }),
    ),
  );
}

/** Counts token-endpoint hits, which is the number this whole module is about. */
function stubToken(respond: (callCount: number) => Response | Promise<Response>): {
  readonly calls: () => number;
} {
  let calls = 0;
  server.use(
    http.post(TOKEN_URL, async () => {
      calls += 1;
      return respond(calls);
    }),
  );
  return { calls: () => calls };
}

const OK_BODY = {
  access_token: "new-access",
  refresh_token: "rotated-refresh",
  id_token: "new-id",
  expires_in: 300,
};

beforeEach(() => {
  clearRefreshCache();
  clearDiscoveryCache();
  stubDiscovery();
});

afterEach(() => {
  clearRefreshCache();
  clearDiscoveryCache();
});

describe("refreshAccessToken", () => {
  it("exchanges a refresh token for a new token set", async () => {
    stubToken(() => HttpResponse.json(OK_BODY));

    const outcome = await refreshAccessToken("old-refresh");

    expect(outcome.status).toBe("refreshed");
    expect(outcome.status === "refreshed" ? outcome.tokens.accessToken : null).toBe("new-access");
    expect(outcome.status === "refreshed" ? outcome.tokens.refreshToken : null).toBe(
      "rotated-refresh",
    );
  });

  it("sends the confidential client's credentials in the grant", async () => {
    let body = "";
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json(OK_BODY);
      }),
    );

    await refreshAccessToken("old-refresh");
    const params = new URLSearchParams(body);

    expect(params.get("grant_type")).toBe("refresh_token");
    expect(params.get("refresh_token")).toBe("old-refresh");
    expect(params.get("client_id")).toBe("koala-admin-web");
    expect(params.get("client_secret")).toBe("test-client-secret");
  });

  /**
   * The reason this module exists. With rotation on, spending the same refresh
   * token twice does not fail one call — Keycloak revokes the whole SSO
   * session. A single page view fans out into the proxy plus several server
   * renders, all holding the same cookie.
   */
  it("collapses simultaneous refreshes of the same token into one call", async () => {
    const { calls } = stubToken(
      async () =>
        new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(HttpResponse.json(OK_BODY));
          }, 25);
        }),
    );

    const outcomes = await Promise.all([
      refreshAccessToken("old-refresh"),
      refreshAccessToken("old-refresh"),
      refreshAccessToken("old-refresh"),
      refreshAccessToken("old-refresh"),
      refreshAccessToken("old-refresh"),
    ]);

    expect(calls()).toBe(1);
    for (const outcome of outcomes) {
      expect(outcome.status).toBe("refreshed");
      expect(outcome.status === "refreshed" ? outcome.tokens.accessToken : null).toBe("new-access");
    }
  });

  /**
   * The subtler half. Auth.js can only write the rotated cookie onto the
   * proxy's response, so a server render *inside the same request* still reads
   * the pre-refresh cookie and asks again — a moment after the first call
   * finished, not during it.
   */
  it("keeps answering for a token it already spent", async () => {
    const { calls } = stubToken(() => HttpResponse.json(OK_BODY));

    const first = await refreshAccessToken("old-refresh");
    const second = await refreshAccessToken("old-refresh");

    expect(calls()).toBe(1);
    expect(second).toEqual(first);
  });

  it("still refreshes a genuinely different token", async () => {
    const { calls } = stubToken((n) =>
      HttpResponse.json({ ...OK_BODY, access_token: `access-${n}` }),
    );

    await refreshAccessToken("refresh-a");
    await refreshAccessToken("refresh-b");

    expect(calls()).toBe(2);
  });

  it("classifies Keycloak's refusal as rejected, and does not cache it", async () => {
    // `invalid_grant` is final: the token is revoked, expired or already spent.
    // Caching it would only delay the login screen the person needs.
    const { calls } = stubToken(() =>
      HttpResponse.json(
        { error: "invalid_grant", error_description: "Token is not active" },
        { status: 400 },
      ),
    );

    const first = await refreshAccessToken("dead-refresh");
    const second = await refreshAccessToken("dead-refresh");

    expect(first.status).toBe("rejected");
    expect(first.status === "rejected" ? first.reason : "").toContain("invalid_grant");
    expect(second.status).toBe("rejected");
    expect(calls()).toBe(2);
  });

  it("classifies a network failure as unreachable, not as a refusal", async () => {
    // The difference decides whether the person is signed out or shown "Keycloak
    // is down". Getting it wrong logs everyone out over a restart.
    stubToken(() => HttpResponse.error());

    const outcome = await refreshAccessToken("old-refresh");

    expect(outcome.status).toBe("unreachable");
  });

  it("treats a 5xx as unreachable and a 4xx as rejected", async () => {
    stubToken(() => new HttpResponse(null, { status: 502 }));
    expect((await refreshAccessToken("token-a")).status).toBe("unreachable");

    stubToken(() => new HttpResponse(null, { status: 401 }));
    expect((await refreshAccessToken("token-b")).status).toBe("rejected");
  });

  it("rejects a 200 that carries no access token", async () => {
    stubToken(() => HttpResponse.json({ token_type: "Bearer" }));

    expect((await refreshAccessToken("old-refresh")).status).toBe("rejected");
  });

  it("reports unreachable when discovery itself fails", async () => {
    clearDiscoveryCache();
    server.use(http.get(DISCOVERY_URL, () => HttpResponse.error()));

    expect((await refreshAccessToken("old-refresh")).status).toBe("unreachable");
  });
});

describe("readTokenResponse", () => {
  it("keeps the previous refresh token when rotation is off", () => {
    const tokens = readTokenResponse({ access_token: "a", expires_in: 60 }, "previous-refresh");

    expect(tokens?.refreshToken).toBe("previous-refresh");
  });

  it("keeps the previous id token when the refresh omits one", () => {
    // Losing it silently breaks RP-initiated logout, which has no other way to
    // prove which session is ending — and a broken logout looks like it worked.
    const tokens = readTokenResponse({ access_token: "a" }, "r", "previous-id");

    expect(tokens?.idToken).toBe("previous-id");
  });

  it("converts expires_in into an absolute millisecond deadline", () => {
    const tokens = readTokenResponse({ access_token: "a", expires_in: 300 }, "r", null, 1_000);

    expect(tokens?.expiresAt).toBe(301_000);
  });

  it("falls back to the realm's 5-minute lifespan when expires_in is absent", () => {
    const tokens = readTokenResponse({ access_token: "a" }, "r", null, 0);

    expect(tokens?.expiresAt).toBe(300_000);
  });

  it("is null for a body with no access token", () => {
    expect(readTokenResponse({}, "r")).toBeNull();
    expect(readTokenResponse(null, "r")).toBeNull();
    expect(readTokenResponse({ access_token: "" }, "r")).toBeNull();
  });
});
