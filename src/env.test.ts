import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env";

describe("parseServerEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = parseServerEnv({ KOALA_API_BASE_URL: "http://localhost:8080" });

    expect(env.KOALA_API_BASE_URL).toBe("http://localhost:8080");
    expect(env.KOALA_API_TIMEOUT_MS).toBe(15_000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("normalises a trailing slash so paths join cleanly", () => {
    const env = parseServerEnv({ KOALA_API_BASE_URL: "https://api.iskoala.com/" });

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
    expect(() => parseServerEnv({ KOALA_API_BASE_URL: "api.iskoala.com" })).toThrow(
      /geçerli bir mutlak URL/,
    );
    // `localhost:8080` does parse — as scheme `localhost:` with an opaque path,
    // which is the classic way this variable gets set wrong.
    expect(() => parseServerEnv({ KOALA_API_BASE_URL: "localhost:8080" })).toThrow(
      /http ya da https/,
    );
    expect(() => parseServerEnv({ KOALA_API_BASE_URL: "ftp://api.iskoala.com" })).toThrow(
      /http ya da https/,
    );
  });

  it("rejects a nonsensical timeout instead of silently coercing it", () => {
    expect(() =>
      parseServerEnv({ KOALA_API_BASE_URL: "http://localhost:8080", KOALA_API_TIMEOUT_MS: "0" }),
    ).toThrow(EnvValidationError);

    expect(() =>
      parseServerEnv({
        KOALA_API_BASE_URL: "http://localhost:8080",
        KOALA_API_TIMEOUT_MS: "hemen",
      }),
    ).toThrow(EnvValidationError);
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
});
