import { http, HttpResponse } from "msw";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "../../../test/msw";
import { clearDiscoveryCache, getKeycloakEndpoints } from "./discovery";
import { isStaffAuthError } from "./errors";

const ISSUER = "http://localhost:8085/realms/koala-staff";
const DISCOVERY_URL = `${ISSUER}/.well-known/openid-configuration`;

const DOCUMENT = {
  issuer: ISSUER,
  token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
  end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
};

beforeEach(() => {
  clearDiscoveryCache();
});

afterEach(() => {
  clearDiscoveryCache();
});

describe("getKeycloakEndpoints", () => {
  it("reads both endpoints from the realm's discovery document", async () => {
    server.use(http.get(DISCOVERY_URL, () => HttpResponse.json(DOCUMENT)));

    await expect(getKeycloakEndpoints()).resolves.toEqual({
      tokenEndpoint: DOCUMENT.token_endpoint,
      endSessionEndpoint: DOCUMENT.end_session_endpoint,
    });
  });

  it("asks once and reuses the answer", async () => {
    let calls = 0;
    server.use(
      http.get(DISCOVERY_URL, () => {
        calls += 1;
        return HttpResponse.json(DOCUMENT);
      }),
    );

    await getKeycloakEndpoints();
    await getKeycloakEndpoints();
    await getKeycloakEndpoints();

    expect(calls).toBe(1);
  });

  it("reports an unreachable realm as KEYCLOAK_UNREACHABLE, not as a generic error", async () => {
    // This code is what the error page keys off; a plain Error here becomes a
    // 500 instead of a page explaining that Keycloak is the reason.
    server.use(http.get(DISCOVERY_URL, () => HttpResponse.error()));

    const error = await getKeycloakEndpoints().catch((caught: unknown) => caught);

    expect(isStaffAuthError(error)).toBe(true);
    expect(isStaffAuthError(error) ? error.code : null).toBe("KEYCLOAK_UNREACHABLE");
  });

  it("treats a 503 from the realm the same way", async () => {
    server.use(http.get(DISCOVERY_URL, () => new HttpResponse(null, { status: 503 })));

    const error = await getKeycloakEndpoints().catch((caught: unknown) => caught);

    expect(isStaffAuthError(error) ? error.code : null).toBe("KEYCLOAK_UNREACHABLE");
  });

  it("refuses a document missing end_session_endpoint", async () => {
    // Without it there is no RP-initiated logout, and a logout that only clears
    // the local cookie looks like it worked while the SSO session stays open.
    server.use(
      http.get(DISCOVERY_URL, () =>
        HttpResponse.json({ issuer: ISSUER, token_endpoint: DOCUMENT.token_endpoint }),
      ),
    );

    const error = await getKeycloakEndpoints().catch((caught: unknown) => caught);

    expect(isStaffAuthError(error) ? error.code : null).toBe("KEYCLOAK_UNREACHABLE");
  });

  it("does not cache a failure", async () => {
    server.use(http.get(DISCOVERY_URL, () => HttpResponse.error()));
    await expect(getKeycloakEndpoints()).rejects.toThrow();

    server.use(http.get(DISCOVERY_URL, () => HttpResponse.json(DOCUMENT)));
    await expect(getKeycloakEndpoints()).resolves.toMatchObject({
      tokenEndpoint: DOCUMENT.token_endpoint,
    });
  });
});
