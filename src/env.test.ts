import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env";

/** Every required variable, so a test can vary one thing at a time. */
const COMPLETE = {
  KOALA_API_BASE_URL: "http://localhost:8080",
  AUTH_URL: "http://localhost:3000",
  AUTH_SECRET: "0123456789abcdef0123456789abcdef",
  KEYCLOAK_ISSUER: "http://localhost:8085/realms/koala-staff",
  KEYCLOAK_CLIENT_SECRET: "local-dev-only",
} as const;

describe("parseServerEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = parseServerEnv({ ...COMPLETE });

    expect(env.KOALA_API_BASE_URL).toBe("http://localhost:8080");
    expect(env.KOALA_API_TIMEOUT_MS).toBe(15_000);
    expect(env.NODE_ENV).toBe("development");
    expect(env.KEYCLOAK_CLIENT_ID).toBe("koala-admin-web");
    expect(env.KOALA_API_AUDIENCE).toBe("koala-api");
  });

  it("normalises a trailing slash so paths join cleanly", () => {
    const env = parseServerEnv({ ...COMPLETE, KOALA_API_BASE_URL: "https://api.iskoala.com/" });

    expect(env.KOALA_API_BASE_URL).toBe("https://api.iskoala.com");
  });

  it("refuses to start when a required variable is missing", () => {
    // The failure the issue cares about: the app must stop, not half-boot and
    // then fetch "undefined/reference/job-categories".
    expect(() => parseServerEnv({})).toThrow(EnvValidationError);

    try {
      parseServerEnv({});
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain("Ortam değişkenleri doğrulanamadı");
      expect(message).toContain("KOALA_API_BASE_URL");
      expect(message).toContain(".env.example");
    }
  });

  it("rejects a base URL that is not an absolute http(s) URL", () => {
    // No scheme at all.
    expect(() => parseServerEnv({ ...COMPLETE, KOALA_API_BASE_URL: "api.iskoala.com" })).toThrow(
      /geçerli bir mutlak URL/,
    );
    // `localhost:8080` does parse — as scheme `localhost:` with an opaque path,
    // which is the classic way this variable gets set wrong.
    expect(() => parseServerEnv({ ...COMPLETE, KOALA_API_BASE_URL: "localhost:8080" })).toThrow(
      /http ya da https/,
    );
    expect(() =>
      parseServerEnv({ ...COMPLETE, KOALA_API_BASE_URL: "ftp://api.iskoala.com" }),
    ).toThrow(/http ya da https/);
  });

  it("rejects a nonsensical timeout instead of silently coercing it", () => {
    expect(() => parseServerEnv({ ...COMPLETE, KOALA_API_TIMEOUT_MS: "0" })).toThrow(
      EnvValidationError,
    );

    expect(() => parseServerEnv({ ...COMPLETE, KOALA_API_TIMEOUT_MS: "hemen" })).toThrow(
      EnvValidationError,
    );
  });

  it("lists every offending variable at once", () => {
    try {
      parseServerEnv({ KOALA_API_TIMEOUT_MS: "-1", NODE_ENV: "staging" });
      expect.unreachable("should have thrown");
    } catch (error) {
      const issues = (error as EnvValidationError).issues;
      expect(issues.join("\n")).toContain("KOALA_API_BASE_URL");
      expect(issues.join("\n")).toContain("KOALA_API_TIMEOUT_MS");
      expect(issues.join("\n")).toContain("NODE_ENV");
    }
  });

  it("refuses a client secret that is missing, and says where to find it", () => {
    // The one variable that is a real secret. An empty string is the shape this
    // goes wrong in — a `.env.local` copied from the template and never filled.
    expect(() => parseServerEnv({ ...COMPLETE, KEYCLOAK_CLIENT_SECRET: "" })).toThrow(
      /KEYCLOAK_CLIENT_SECRET/,
    );
  });

  it("refuses a session secret too short to be one", () => {
    expect(() => parseServerEnv({ ...COMPLETE, AUTH_SECRET: "kısa" })).toThrow(/en az 32 karakter/);
  });

  it("allows plain http only against localhost", () => {
    // Locally Keycloak and the panel are http containers. Anywhere else, plain
    // http would put the client secret, the authorization code and the session
    // cookie on the wire in the clear.
    expect(
      parseServerEnv({ ...COMPLETE, KEYCLOAK_ISSUER: "http://127.0.0.1:8085/realms/koala-staff" })
        .KEYCLOAK_ISSUER,
    ).toBe("http://127.0.0.1:8085/realms/koala-staff");

    expect(() =>
      parseServerEnv({
        ...COMPLETE,
        KEYCLOAK_ISSUER: "http://auth.iskoala.com/realms/koala-staff",
      }),
    ).toThrow(/localhost dışında https/);

    expect(() => parseServerEnv({ ...COMPLETE, AUTH_URL: "http://admin.iskoala.com" })).toThrow(
      /localhost dışında https/,
    );
  });

  it("lists every missing auth variable at once", () => {
    try {
      parseServerEnv({ KOALA_API_BASE_URL: "http://localhost:8080" });
      expect.unreachable("should have thrown");
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toContain("AUTH_URL");
      expect(issues).toContain("AUTH_SECRET");
      expect(issues).toContain("KEYCLOAK_ISSUER");
      expect(issues).toContain("KEYCLOAK_CLIENT_SECRET");
    }
  });
});
