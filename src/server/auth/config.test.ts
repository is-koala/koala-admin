import { http, HttpResponse } from "msw";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "../../../test/msw";
import { authConfig } from "./config";
import { clearDiscoveryCache } from "./discovery";
import { clearRefreshCache } from "./refresh";

const ISSUER = "http://localhost:8085/realms/koala-staff";
const TOKEN_URL = `${ISSUER}/protocol/openid-connect/token`;

function accessToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.sig`;
}

const WELL_ADDRESSED = accessToken({
  aud: ["koala-api", "account"],
  realm_access: { roles: ["OWNER", "SUPPORT_AGENT"] },
});

const WRONG_AUDIENCE = accessToken({
  aud: ["account"],
  realm_access: { roles: ["OWNER"] },
});

/** Narrow the callbacks once so each test does not repeat the check. */
const jwtCallback = authConfig.callbacks?.jwt;
const sessionCallback = authConfig.callbacks?.session;

type JwtParams = Parameters<NonNullable<typeof jwtCallback>>[0];
type SessionParams = Parameters<NonNullable<typeof sessionCallback>>[0];

async function runJwt(params: Partial<JwtParams>): Promise<JWT | null> {
  if (jwtCallback === undefined) throw new Error("jwt callback missing");
  return jwtCallback(params as JwtParams);
}

async function runSession(token: JWT): Promise<Session> {
  if (sessionCallback === undefined) throw new Error("session callback missing");
  const session = { user: {}, expires: new Date(Date.now() + 60_000).toISOString() };
  return sessionCallback({ session, token } as SessionParams) as Promise<Session>;
}

function stubDiscovery(): void {
  server.use(
    http.get(`${ISSUER}/.well-known/openid-configuration`, () =>
      HttpResponse.json({
        issuer: ISSUER,
        token_endpoint: TOKEN_URL,
        end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
      }),
    ),
  );
}

beforeEach(() => {
  clearRefreshCache();
  clearDiscoveryCache();
  stubDiscovery();
});

afterEach(() => {
  clearRefreshCache();
  clearDiscoveryCache();
});

describe("the session callback — the wall between the server and the browser", () => {
  it("exposes no token of any kind", async () => {
    // The acceptance criterion in prose: no access token anywhere the browser
    // can reach. `/api/auth/session` is built by this callback, so it is the
    // one place a token could escape by accident.
    const session = await runSession({
      sub: "staff-1",
      name: "Yerel Owner",
      email: "owner@koala.local",
      accessToken: "ACCESS-TOKEN-SECRET",
      refreshToken: "REFRESH-TOKEN-SECRET",
      idToken: "ID-TOKEN-SECRET",
      accessTokenExpiresAt: Date.now() + 300_000,
      roles: ["OWNER"],
    });

    const serialised = JSON.stringify(session);

    expect(serialised).not.toContain("ACCESS-TOKEN-SECRET");
    expect(serialised).not.toContain("REFRESH-TOKEN-SECRET");
    expect(serialised).not.toContain("ID-TOKEN-SECRET");
    expect(Object.keys(session)).not.toContain("accessToken");
    expect(Object.keys(session)).not.toContain("refreshToken");
    expect(Object.keys(session)).not.toContain("idToken");
  });

  it("passes on identity, roles and the failure code, and nothing else", async () => {
    const session = await runSession({
      sub: "staff-1",
      name: "Yerel Owner",
      email: "owner@koala.local",
      roles: ["OWNER", "TRUST_LEAD"],
    });

    expect(session.user?.email).toBe("owner@koala.local");
    expect(session.roles).toEqual(["OWNER", "TRUST_LEAD"]);
    expect(session.authError).toBeNull();
  });

  it("reports a token that cannot be used", async () => {
    const session = await runSession({ sub: "s", authError: "AUDIENCE_MISCONFIGURED" });

    expect(session.authError).toBe("AUDIENCE_MISCONFIGURED");
  });

  it("does not invent roles when the mapper produced none", async () => {
    const session = await runSession({ sub: "s" });

    expect(session.roles).toEqual([]);
  });
});

describe("the jwt callback — sign-in", () => {
  it("stores the token set and the realm roles", async () => {
    const token = await runJwt({
      token: {},
      account: {
        provider: "keycloak",
        providerAccountId: "staff-1",
        type: "oidc",
        access_token: WELL_ADDRESSED,
        refresh_token: "refresh-1",
        id_token: "id-1",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    });

    expect(token?.accessToken).toBe(WELL_ADDRESSED);
    expect(token?.refreshToken).toBe("refresh-1");
    expect(token?.roles).toEqual(["OWNER", "SUPPORT_AGENT"]);
    expect(token?.authError).toBeUndefined();
  });

  it("converts expires_at from seconds to milliseconds", async () => {
    // Auth.js speaks seconds and this codebase speaks milliseconds. Mixing them
    // would make every token look expired for the next 55 years.
    const expiresAtSeconds = Math.floor(Date.now() / 1000) + 300;

    const token = await runJwt({
      token: {},
      account: {
        provider: "keycloak",
        providerAccountId: "staff-1",
        type: "oidc",
        access_token: WELL_ADDRESSED,
        refresh_token: "refresh-1",
        expires_at: expiresAtSeconds,
      },
    });

    expect(token?.accessTokenExpiresAt).toBe(expiresAtSeconds * 1000);
  });

  it("marks a token addressed to the wrong audience as a configuration failure", async () => {
    // Not "access denied". The person's roles are intact; a realm mapper is off.
    const token = await runJwt({
      token: {},
      account: {
        provider: "keycloak",
        providerAccountId: "staff-1",
        type: "oidc",
        access_token: WRONG_AUDIENCE,
        refresh_token: "refresh-1",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    });

    expect(token?.authError).toBe("AUDIENCE_MISCONFIGURED");
    expect(token?.roles).toEqual(["OWNER"]);
  });
});

describe("the jwt callback — keeping the session alive", () => {
  it("leaves a still-valid token alone and asks Keycloak nothing", async () => {
    // No token-endpoint handler is registered, so a request here would fail the
    // test outright — which is the assertion.
    const token: JWT = {
      accessToken: WELL_ADDRESSED,
      refreshToken: "refresh-1",
      accessTokenExpiresAt: Date.now() + 240_000,
      roles: ["OWNER"],
    };

    await expect(runJwt({ token })).resolves.toEqual(token);
  });

  it("refreshes before expiry rather than after it", async () => {
    // 30 seconds left is still "valid", and refreshing then is what keeps an
    // action from failing mid-flight on a 5-minute token.
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, () => {
        calls += 1;
        return HttpResponse.json({
          access_token: WELL_ADDRESSED,
          refresh_token: "rotated",
          expires_in: 300,
        });
      }),
    );

    const token = await runJwt({
      token: {
        accessToken: "about-to-die",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 30_000,
      },
    });

    expect(calls).toBe(1);
    expect(token?.accessToken).toBe(WELL_ADDRESSED);
    expect(token?.refreshToken).toBe("rotated");
  });

  it("drops the session when Keycloak refuses the refresh token", async () => {
    // Returning null is what makes Auth.js clear the cookie. Anything else
    // leaves a cookie that looks like a session and buys nothing.
    server.use(
      http.post(TOKEN_URL, () => HttpResponse.json({ error: "invalid_grant" }, { status: 400 })),
    );

    const token = await runJwt({
      token: {
        accessToken: "stale",
        refreshToken: "revoked",
        accessTokenExpiresAt: Date.now() - 1_000,
      },
    });

    expect(token).toBeNull();
  });

  it("drops the session when there is no refresh token to spend", async () => {
    await expect(runJwt({ token: { accessToken: "stale" } })).resolves.toBeNull();
  });

  it("throws the stale access token away when Keycloak is unreachable", async () => {
    // Two things at once: never carry on with an expired token, and never
    // discard a session that will be fine the moment Keycloak answers.
    server.use(http.post(TOKEN_URL, () => HttpResponse.error()));

    const token = await runJwt({
      token: {
        accessToken: "stale",
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() - 1_000,
      },
    });

    expect(token).not.toBeNull();
    expect(token?.accessToken).toBeUndefined();
    expect(token?.authError).toBe("KEYCLOAK_UNREACHABLE");
    expect(token?.refreshToken).toBe("refresh-1");
  });

  it("does not refresh on a loop just because the audience is wrong", async () => {
    /**
     * The trap this guards. A misconfigured audience is a realm mapper, not a
     * stale token, so refreshing cannot fix it — and refreshing on every
     * request would spend a rotated refresh token several times a second,
     * which Keycloak answers by revoking the session. Silent, and much worse
     * than the original problem.
     */
    let calls = 0;
    server.use(
      http.post(TOKEN_URL, () => {
        calls += 1;
        return HttpResponse.json({ access_token: WRONG_AUDIENCE, expires_in: 300 });
      }),
    );

    const token = await runJwt({
      token: {
        accessToken: WRONG_AUDIENCE,
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() + 240_000,
        authError: "AUDIENCE_MISCONFIGURED",
      },
    });

    expect(calls).toBe(0);
    expect(token?.authError).toBe("AUDIENCE_MISCONFIGURED");
  });

  it("clears the configuration failure once the mapper is switched back on", async () => {
    server.use(
      http.post(TOKEN_URL, () =>
        HttpResponse.json({
          access_token: WELL_ADDRESSED,
          refresh_token: "rotated",
          expires_in: 300,
        }),
      ),
    );

    const token = await runJwt({
      token: {
        accessToken: WRONG_AUDIENCE,
        refreshToken: "refresh-1",
        accessTokenExpiresAt: Date.now() - 1,
        authError: "AUDIENCE_MISCONFIGURED",
      },
    });

    expect(token?.authError).toBeUndefined();
  });
});

describe("the configuration itself", () => {
  it("gates the session cookie the way the issue asks", () => {
    const cookie = authConfig.cookies?.sessionToken;

    expect(cookie?.options?.httpOnly).toBe(true);
    expect(cookie?.options?.sameSite).toBe("lax");
    // `secure` follows AUTH_URL, which the test env sets to http://localhost.
    expect(cookie?.options?.secure).toBe(false);
    expect(cookie?.name).toBe("authjs.session-token");
  });

  it("keeps the session in a cookie and no longer than the realm's SSO maximum", () => {
    expect(authConfig.session?.strategy).toBe("jwt");
    expect(authConfig.session?.maxAge).toBe(8 * 60 * 60);
  });

  it("performs Authorization Code + PKCE and nothing else", () => {
    // The realm has direct access grants and implicit switched off; this is the
    // panel's half of that agreement, written down rather than inherited.
    const provider = authConfig.providers[0] as {
      id?: string;
      type?: string;
      // Auth.js keeps caller-supplied provider options here until it merges them.
      options?: {
        checks?: readonly string[];
        issuer?: string;
        authorization?: { params?: { scope?: string } };
      };
    };

    expect(provider.id).toBe("keycloak");
    expect(provider.type).toBe("oidc");
    expect(provider.options?.checks).toEqual(["pkce", "state"]);
    expect(provider.options?.issuer).toBe(ISSUER);
    expect(provider.options?.authorization?.params?.scope).toBe("openid profile email");
  });

  it("sends every auth page to the panel's own single-button screens", () => {
    expect(authConfig.pages?.signIn).toBe("/giris");
    expect(authConfig.pages?.error).toBe("/giris/hata");
  });
});
