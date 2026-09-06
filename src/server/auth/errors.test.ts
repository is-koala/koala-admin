import { describe, expect, it } from "vitest";

import { fromAuthjsErrorCode, isAuthFailureCode, StaffAuthError } from "./errors";

describe("fromAuthjsErrorCode", () => {
  it("translates Auth.js's `Configuration` into what it actually means", () => {
    // The misleading one. `Configuration` is what a failed OIDC discovery
    // arrives as — Keycloak did not answer — and showing the word
    // "configuration" to a person who cannot log in explains nothing.
    expect(fromAuthjsErrorCode("Configuration")).toBe("KEYCLOAK_UNREACHABLE");
  });

  it("keeps a refusal a refusal", () => {
    expect(fromAuthjsErrorCode("AccessDenied")).toBe("ACCESS_DENIED");
  });

  it("treats an absent code as 'you need to sign in'", () => {
    expect(fromAuthjsErrorCode(undefined)).toBe("SESSION_REQUIRED");
    expect(fromAuthjsErrorCode(null)).toBe("SESSION_REQUIRED");
    expect(fromAuthjsErrorCode("")).toBe("SESSION_REQUIRED");
  });

  it("passes our own codes straight through", () => {
    // The proxy writes these; the error page reads both vocabularies.
    expect(fromAuthjsErrorCode("AUDIENCE_MISCONFIGURED")).toBe("AUDIENCE_MISCONFIGURED");
    expect(fromAuthjsErrorCode("KEYCLOAK_UNREACHABLE")).toBe("KEYCLOAK_UNREACHABLE");
  });

  it("falls back rather than rendering an attacker's string", () => {
    // The value comes from the query string, and the error page indexes a table
    // with it.
    expect(fromAuthjsErrorCode("Verification")).toBe("UNKNOWN");
    expect(fromAuthjsErrorCode("<script>")).toBe("UNKNOWN");
    expect(fromAuthjsErrorCode("constructor")).toBe("UNKNOWN");
    expect(fromAuthjsErrorCode("__proto__")).toBe("UNKNOWN");
  });
});

describe("isAuthFailureCode", () => {
  it("accepts only the codes the panel knows how to explain", () => {
    expect(isAuthFailureCode("AUDIENCE_MISCONFIGURED")).toBe(true);
    expect(isAuthFailureCode("toString")).toBe(false);
    expect(isAuthFailureCode(42)).toBe(false);
    expect(isAuthFailureCode(undefined)).toBe(false);
  });
});

describe("StaffAuthError", () => {
  it("carries the code, so a caller branches on it rather than on the message", () => {
    const error = new StaffAuthError("AUDIENCE_MISCONFIGURED", "audience yanlış");

    expect(error.code).toBe("AUDIENCE_MISCONFIGURED");
    expect(error.name).toBe("StaffAuthError");
    expect(error.message).toBe("audience yanlış");
  });
});
