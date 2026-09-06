import { describe, expect, it } from "vitest";

import {
  decodeJwtPayload,
  hasAudience,
  readAudiences,
  readExpiryMs,
  readRealmRoles,
} from "./claims";

/** Builds a token with the given payload. Signature is irrelevant — nothing here verifies one. */
function token(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    btoa(JSON.stringify(value)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(payload)}.c2ln`;
}

describe("decodeJwtPayload", () => {
  it("reads the payload of a well-formed token", () => {
    expect(decodeJwtPayload(token({ sub: "abc" }))).toEqual({ sub: "abc" });
  });

  it("survives every shape of garbage instead of throwing", () => {
    // This runs on a value that arrived over the network; a throw here would
    // become a 500 on a page that could have said something useful.
    expect(decodeJwtPayload("")).toBeNull();
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("a.b")).toBeNull();
    expect(decodeJwtPayload("a..c")).toBeNull();
    expect(decodeJwtPayload("a.!!!.c")).toBeNull();
    expect(decodeJwtPayload(`a.${btoa('"just a string"')}.c`)).toBeNull();
  });

  it("decodes base64url padding correctly", () => {
    // Keycloak payloads are long enough that a padding bug only shows up on
    // some tokens, which is the worst way for it to show up.
    for (const length of [1, 2, 3, 4, 5]) {
      const value = "x".repeat(length);
      expect(decodeJwtPayload(token({ value }))).toEqual({ value });
    }
  });
});

describe("readAudiences", () => {
  it("accepts both shapes RFC 7519 allows", () => {
    expect(readAudiences(token({ aud: "koala-api" }))).toEqual(["koala-api"]);
    expect(readAudiences(token({ aud: ["koala-api", "account"] }))).toEqual([
      "koala-api",
      "account",
    ]);
  });

  it("is empty when there is no audience at all", () => {
    // Exactly what a token minted without the audience mapper looks like.
    expect(readAudiences(token({ sub: "abc" }))).toEqual([]);
  });
});

describe("hasAudience", () => {
  it("recognises the audience among several", () => {
    expect(hasAudience(token({ aud: ["account", "koala-api"] }), "koala-api")).toBe(true);
  });

  it("is false when the mapper is off", () => {
    // The whole point: this false is what lets the panel say "configuration
    // error" instead of repeating the backend's 401 as "you lack permission".
    expect(hasAudience(token({ aud: ["account"] }), "koala-api")).toBe(false);
    expect(hasAudience(token({}), "koala-api")).toBe(false);
    expect(hasAudience("garbage", "koala-api")).toBe(false);
  });

  it("does not accept a near miss", () => {
    expect(hasAudience(token({ aud: "koala-api-staging" }), "koala-api")).toBe(false);
  });
});

describe("readRealmRoles", () => {
  it("reads the claim the realm-role mapper writes", () => {
    expect(readRealmRoles(token({ realm_access: { roles: ["OWNER", "SUPPORT_AGENT"] } }))).toEqual([
      "OWNER",
      "SUPPORT_AGENT",
    ]);
  });

  it("is empty rather than broken when the claim is missing or malformed", () => {
    expect(readRealmRoles(token({}))).toEqual([]);
    expect(readRealmRoles(token({ realm_access: null }))).toEqual([]);
    expect(readRealmRoles(token({ realm_access: { roles: "OWNER" } }))).toEqual([]);
  });

  it("drops non-string entries instead of passing them on", () => {
    expect(readRealmRoles(token({ realm_access: { roles: ["OWNER", 42, null] } }))).toEqual([
      "OWNER",
    ]);
  });
});

describe("readExpiryMs", () => {
  it("converts the seconds-based claim to milliseconds", () => {
    // `exp` is seconds and everything else in this codebase is milliseconds;
    // the conversion is the whole reason this function exists.
    expect(readExpiryMs(token({ exp: 1_700_000_000 }))).toBe(1_700_000_000_000);
  });

  it("is null when there is no usable exp", () => {
    expect(readExpiryMs(token({}))).toBeNull();
    expect(readExpiryMs(token({ exp: "soon" }))).toBeNull();
  });
});
