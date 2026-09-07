import { describe, expect, it } from "vitest";

import {
  isAuthFailureCode,
  isPasswordChangeFailureCode,
  isSignInFailureCode,
  StaffAuthError,
} from "./errors";

describe("isAuthFailureCode", () => {
  it("accepts only the codes the panel knows how to explain", () => {
    expect(isAuthFailureCode("SESSION_EXPIRED")).toBe(true);
    expect(isAuthFailureCode("PASSWORD_CHANGE_REQUIRED")).toBe(true);
    expect(isAuthFailureCode("BACKEND_UNREACHABLE")).toBe(true);
  });

  it("falls back rather than letting a query string index a table", () => {
    // `/giris/hata` reads `?kod=` and looks the value up in a `Record`. Without
    // this guard, `__proto__` or `toString` would resolve to something.
    expect(isAuthFailureCode("toString")).toBe(false);
    expect(isAuthFailureCode("constructor")).toBe(false);
    expect(isAuthFailureCode("__proto__")).toBe(false);
    expect(isAuthFailureCode("<script>")).toBe(false);
    expect(isAuthFailureCode(42)).toBe(false);
    expect(isAuthFailureCode(undefined)).toBe(false);
  });

  it("no longer knows a code that only a Keycloak could produce", () => {
    // ADR-0014 removed the identity provider. A code coming back here would
    // mean a screen explaining a failure that can no longer happen.
    expect(isAuthFailureCode("KEYCLOAK_UNREACHABLE")).toBe(false);
    expect(isAuthFailureCode("AUDIENCE_MISCONFIGURED")).toBe(false);
  });
});

describe("isSignInFailureCode", () => {
  it("accepts the form's own vocabulary and nothing else", () => {
    expect(isSignInFailureCode("INVALID_CREDENTIALS")).toBe(true);
    expect(isSignInFailureCode("TOO_MANY_ATTEMPTS")).toBe(true);
    expect(isSignInFailureCode("SESSION_EXPIRED")).toBe(false);
    expect(isSignInFailureCode("__proto__")).toBe(false);
  });

  it("has one code for a wrong password and a missing account, deliberately", () => {
    // The backend answers both identically (`StaffLoginIT`). A second code here
    // would reopen, in the panel, the account-existence leak the backend closed.
    expect(isSignInFailureCode("ACCOUNT_NOT_FOUND")).toBe(false);
    expect(isSignInFailureCode("WRONG_PASSWORD")).toBe(false);
    expect(isSignInFailureCode("ACCOUNT_LOCKED")).toBe(false);
  });
});

describe("isPasswordChangeFailureCode", () => {
  it("accepts the password screen's vocabulary and nothing else", () => {
    expect(isPasswordChangeFailureCode("CURRENT_PASSWORD_WRONG")).toBe(true);
    expect(isPasswordChangeFailureCode("PASSWORD_UNCHANGED")).toBe(true);
    expect(isPasswordChangeFailureCode("MISMATCH")).toBe(true);
    expect(isPasswordChangeFailureCode("INVALID_CREDENTIALS")).toBe(false);
    expect(isPasswordChangeFailureCode("toString")).toBe(false);
  });
});

describe("StaffAuthError", () => {
  it("carries the code, so a caller branches on it rather than on the message", () => {
    const error = new StaffAuthError("PASSWORD_CHANGE_REQUIRED", "ilk giriş bayrağı açık");

    expect(error.code).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(error.name).toBe("StaffAuthError");
    expect(error.message).toBe("ilk giriş bayrağı açık");
  });
});
