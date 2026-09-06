import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { http, HttpResponse } from "msw";
import type { Session } from "next-auth";
import type { JWT } from "next-auth/jwt";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { server } from "../../../test/msw";
import { PERMISSIONS } from "../authz/permissions";

import { authConfig } from "./config";
import { clearDiscoveryCache } from "./discovery";
import { clearRefreshCache } from "./refresh";

/**
 * ADR-0010's rule, pinned: **permissions are never in the token and never in
 * the session.**
 *
 * `config.test.ts` proves no *token* escapes to the browser. This proves the
 * opposite direction — that no *permission* gets in. The failure mode it
 * guards against is not a leak but a shortcut: putting the resolved permission
 * list on the session so the menu can be drawn without a backend call. That
 * shortcut works, is faster, and reintroduces exactly the staleness the ADR
 * moved out of the access token — a revoked `payout.release` would stay
 * spendable until the cookie rolled over.
 *
 * Two halves, because neither is enough alone: a runtime check that today's
 * callbacks carry nothing, and a grep proving the auth layer has no way to
 * learn a permission in the first place.
 */

const ISSUER = "http://localhost:8085/realms/koala-staff";

function accessToken(claims: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "RS256" })}.${encode(claims)}.sig`;
}

/** A realm token for someone holding every role the realm defines. */
const OWNER_TOKEN = accessToken({
  aud: ["koala-api", "account"],
  realm_access: {
    roles: [
      "OWNER",
      "CATALOG_EDITOR",
      "SUPPORT_AGENT",
      "MODERATOR",
      "DISPUTE_HANDLER",
      "COMPANY_APPROVER",
      "TRUST_LEAD",
      "FINANCE_ANALYST",
      "FINANCE_OFFICER",
      "AUDITOR",
    ],
  },
});

const jwtCallback = authConfig.callbacks?.jwt;
const sessionCallback = authConfig.callbacks?.session;

async function runJwt(params: Record<string, unknown>): Promise<JWT | null> {
  if (jwtCallback === undefined) throw new Error("jwt callback missing");
  return jwtCallback(params as Parameters<NonNullable<typeof jwtCallback>>[0]);
}

async function runSession(token: JWT): Promise<Session> {
  if (sessionCallback === undefined) throw new Error("session callback missing");
  const session = { user: {}, expires: new Date(Date.now() + 60_000).toISOString() };
  return sessionCallback({ session, token } as Parameters<
    NonNullable<typeof sessionCallback>
  >[0]) as Promise<Session>;
}

beforeEach(() => {
  clearRefreshCache();
  clearDiscoveryCache();
  server.use(
    http.get(`${ISSUER}/.well-known/openid-configuration`, () =>
      HttpResponse.json({
        issuer: ISSUER,
        token_endpoint: `${ISSUER}/protocol/openid-connect/token`,
        end_session_endpoint: `${ISSUER}/protocol/openid-connect/logout`,
      }),
    ),
  );
});

afterEach(() => {
  clearRefreshCache();
  clearDiscoveryCache();
});

describe("no permission reaches the session cookie", () => {
  it("puts no permission name in the JWT, which is what gets encrypted into the cookie", async () => {
    const token = await runJwt({
      token: {},
      account: {
        provider: "keycloak",
        providerAccountId: "staff-1",
        type: "oidc",
        access_token: OWNER_TOKEN,
        refresh_token: "refresh-1",
        id_token: "id-1",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    });

    expect(token).not.toBeNull();
    // The cookie is this object, encrypted. Asserting on the ciphertext would
    // prove nothing; asserting on the plaintext proves everything.
    const serialised = JSON.stringify(token);

    for (const permission of PERMISSIONS) {
      expect(serialised, `JWT içinde ${permission}`).not.toContain(permission);
    }
    expect(Object.keys(token ?? {})).not.toContain("permissions");
  });

  it("puts no permission name in the session object the browser can read", async () => {
    const token = await runJwt({
      token: {},
      account: {
        provider: "keycloak",
        providerAccountId: "staff-1",
        type: "oidc",
        access_token: OWNER_TOKEN,
        refresh_token: "refresh-1",
        expires_at: Math.floor(Date.now() / 1000) + 300,
      },
    });

    const session = await runSession(token ?? {});
    const serialised = JSON.stringify(session);

    for (const permission of PERMISSIONS) {
      expect(serialised, `oturumda ${permission}`).not.toContain(permission);
    }
    expect(Object.keys(session)).not.toContain("permissions");
    expect(Object.keys(session)).not.toContain("izinler");

    // Roles, on the other hand, are exactly what the session is allowed to
    // carry: they say who you are. What they permit is the backend's answer.
    expect(session.roles).toContain("OWNER");
  });

  it("keeps a permission name out even if one is smuggled into the token object", async () => {
    // Someone adds `permissions` to the JWT in a later slice and forgets the
    // session callback is a whitelist. It is, and this pins that.
    const session = await runSession({
      sub: "staff-1",
      roles: ["OWNER"],
      // Not part of the JWT contract in `./types.ts`; Auth.js's `JWT` has an
      // index signature, so nothing at the type level stops someone writing
      // this. That is precisely why the runtime whitelist has to be tested.
      permissions: ["payout.release", "category.manage"],
    });

    expect(JSON.stringify(session)).not.toContain("payout.release");
    expect(Object.keys(session)).not.toContain("permissions");
  });
});

const AUTH_DIR = fileURLToPath(new URL(".", import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

describe("the auth layer has no way to learn a permission", () => {
  it("imports nothing from the authz layer", async () => {
    // The structural half. Keycloak answers "who"; Koala answers "what may
    // they do". An import here would be the first step towards answering the
    // second question from the first, which is the thing ADR-0010 forbids.
    const files = await sourceFiles(AUTH_DIR);
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (/from ["'](@\/server\/authz|\.\.\/authz)/.test(contents)) {
        offenders.push(path.relative(AUTH_DIR, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("uses no permission name as a value anywhere in src/server/auth", async () => {
    // Quoted occurrences only — the same convention as
    // `src/server/api/forbidden-headers.test.ts`. Prose may name a permission
    // (`cookies.ts` explains why the session cookie is worth protecting by
    // pointing at payout.release, and that explanation earns its place);
    // a `"…"` or `'…'` literal is code, and code here would mean the auth
    // layer had started reasoning about permissions. Backticks are markdown in
    // this codebase's comments, so they are not treated as a literal.
    const files = await sourceFiles(AUTH_DIR);
    expect(files.length).toBeGreaterThan(5);

    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const permission of PERMISSIONS) {
        const quoted = [`"${permission}"`, `'${permission}'`];
        if (quoted.some((needle) => contents.includes(needle))) {
          offenders.push(`${path.relative(AUTH_DIR, file)} → ${permission}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
