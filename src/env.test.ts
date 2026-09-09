import { describe, expect, it } from "vitest";

import { EnvValidationError, parseServerEnv } from "./env";

/** Every required variable, so a test can vary one thing at a time. */
const COMPLETE = {
  KOALA_API_BASE_URL: "http://localhost:8080",
  ADMIN_PUBLIC_ORIGIN: "http://localhost:3000",
} as const;

describe("parseServerEnv", () => {
  it("accepts a complete environment and applies defaults", () => {
    const env = parseServerEnv({ ...COMPLETE });

    expect(env.KOALA_API_BASE_URL).toBe("http://localhost:8080");
    expect(env.KOALA_API_TIMEOUT_MS).toBe(15_000);
    expect(env.NODE_ENV).toBe("development");
  });

  it("normalises a trailing slash so paths join cleanly", () => {
    const env = parseServerEnv({ ...COMPLETE, KOALA_API_BASE_URL: "https://api.iskoala.com/" });

    expect(env.KOALA_API_BASE_URL).toBe("https://api.iskoala.com");
  });

  it.each([
    {
      variable: "KOALA_API_BASE_URL",
      value: "  HTTPS://API.ISKOALA.COM:8443/  ",
      expected: "https://api.iskoala.com:8443",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      value: "\tHTTPS://ADMIN.ISKOALA.COM:8443/\n",
      expected: "https://admin.iskoala.com:8443",
    },
    {
      variable: "KOALA_API_BASE_URL",
      value: "HTTP://BACKEND.INTERNAL:8080/",
      expected: "http://backend.internal:8080",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      value: "  HTTP://LOCALHOST:3000/  ",
      expected: "http://localhost:3000",
    },
  ] as const)("canonicalises $variable as a root origin", ({ variable, value, expected }) => {
    const env = parseServerEnv({ ...COMPLETE, [variable]: value });

    expect(env[variable]).toBe(expected);
  });

  it.each([
    {
      variable: "KOALA_API_BASE_URL",
      value: "https://operator@api.iskoala.com",
      secret: "operator",
    },
    {
      variable: "KOALA_API_BASE_URL",
      value: "https://operator:backend-secret@api.iskoala.com",
      secret: "backend-secret",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      value: "https://operator@admin.iskoala.com",
      secret: "operator",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      value: "https://operator:cookie-secret@admin.iskoala.com",
      secret: "cookie-secret",
    },
  ] as const)(
    "rejects credentials in $variable without leaking them",
    ({ variable, value, secret }) => {
      try {
        parseServerEnv({ ...COMPLETE, [variable]: value });
        expect.unreachable("should have rejected a root URL carrying credentials");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const message = (error as EnvValidationError).message;
        expect(message).toContain(variable);
        expect(message).not.toContain(value);
        expect(message).not.toContain(secret);
      }
    },
  );

  it.each([
    {
      variable: "KOALA_API_BASE_URL",
      syntax: "empty userinfo",
      value: "https://@api.iskoala.com",
    },
    {
      variable: "KOALA_API_BASE_URL",
      syntax: "empty username and password",
      value: "https://:@api.iskoala.com",
    },
    {
      variable: "KOALA_API_BASE_URL",
      syntax: "empty port",
      value: "https://api.iskoala.com:",
    },
    {
      variable: "KOALA_API_BASE_URL",
      syntax: "empty port before a root slash",
      value: "https://api.iskoala.com:/",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      syntax: "empty userinfo",
      value: "https://@admin.iskoala.com",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      syntax: "empty username and password",
      value: "https://:@admin.iskoala.com",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      syntax: "empty port",
      value: "https://admin.iskoala.com:",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      syntax: "empty port before a root slash",
      value: "https://admin.iskoala.com:/",
    },
  ] as const)("rejects $syntax syntax in $variable", ({ variable, value }) => {
    try {
      parseServerEnv({ ...COMPLETE, [variable]: value });
      expect.unreachable("should have rejected ambiguous raw authority syntax");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain(variable);
      expect(message).not.toContain(value);
    }
  });

  it.each([
    {
      variable: "KOALA_API_BASE_URL",
      position: "inside the host",
      value: "https://api.iskoala.\ncom",
    },
    {
      variable: "KOALA_API_BASE_URL",
      position: "before the port",
      value: "https://api.iskoala.com\r:8443",
    },
    {
      variable: "KOALA_API_BASE_URL",
      position: "after the port separator",
      value: "https://api.iskoala.com:\t8443",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      position: "inside the host",
      value: "https://admin.iskoala.\ncom",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      position: "before the port",
      value: "https://admin.iskoala.com\r:8443",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      position: "after the port separator",
      value: "https://admin.iskoala.com:\t/",
    },
  ] as const)("rejects an embedded ASCII control $position in $variable", ({ variable, value }) => {
    try {
      parseServerEnv({ ...COMPLETE, [variable]: value });
      expect.unreachable("should have rejected embedded URL control characters");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvValidationError);
      const message = (error as EnvValidationError).message;
      expect(message).toContain(variable);
      expect(message).not.toContain(value);
    }
  });

  it.each([
    {
      variable: "KOALA_API_BASE_URL",
      component: "path",
      value: "https://api.iskoala.com/private/backend-secret",
      secret: "backend-secret",
    },
    {
      variable: "KOALA_API_BASE_URL",
      component: "query",
      value: "https://api.iskoala.com?token=backend-secret",
      secret: "backend-secret",
    },
    {
      variable: "KOALA_API_BASE_URL",
      component: "fragment",
      value: "https://api.iskoala.com#backend-secret",
      secret: "backend-secret",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      component: "path",
      value: "https://admin.iskoala.com/private/cookie-secret",
      secret: "cookie-secret",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      component: "query",
      value: "https://admin.iskoala.com?token=cookie-secret",
      secret: "cookie-secret",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      component: "fragment",
      value: "https://admin.iskoala.com#cookie-secret",
      secret: "cookie-secret",
    },
  ] as const)(
    "rejects a $component in $variable without leaking it",
    ({ variable, value, secret }) => {
      try {
        parseServerEnv({ ...COMPLETE, [variable]: value });
        expect.unreachable("should have rejected a non-root URL");
      } catch (error) {
        expect(error).toBeInstanceOf(EnvValidationError);
        const message = (error as EnvValidationError).message;
        expect(message).toContain(variable);
        expect(message).not.toContain(value);
        expect(message).not.toContain(secret);
      }
    },
  );

  it.each([
    { variable: "KOALA_API_BASE_URL", component: "query", value: "https://api.iskoala.com?" },
    {
      variable: "KOALA_API_BASE_URL",
      component: "fragment",
      value: "https://api.iskoala.com#",
    },
    { variable: "ADMIN_PUBLIC_ORIGIN", component: "query", value: "https://admin.iskoala.com?" },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      component: "fragment",
      value: "https://admin.iskoala.com#",
    },
  ] as const)("rejects an empty $component in $variable", ({ variable, value }) => {
    expect(() => parseServerEnv({ ...COMPLETE, [variable]: value })).toThrow(EnvValidationError);
  });

  it.each([
    {
      variable: "KOALA_API_BASE_URL",
      value: "https://api.iskoala.com/private/..",
    },
    {
      variable: "ADMIN_PUBLIC_ORIGIN",
      value: "https://admin.iskoala.com/.",
    },
    {
      variable: "KOALA_API_BASE_URL",
      value: "https://api.iskoala.com\\",
    },
  ] as const)(
    "rejects a path that the URL parser would collapse in $variable",
    ({ variable, value }) => {
      expect(() => parseServerEnv({ ...COMPLETE, [variable]: value })).toThrow(EnvValidationError);
    },
  );

  it("parses signed-download origins as a strict server-side allowlist", () => {
    const parsed = parseServerEnv({
      ...COMPLETE,
      EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS:
        "https://bucket.s3.eu-central-1.amazonaws.com, https://minio.example.com:9443/",
    });

    expect(parsed.EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS).toEqual([
      "https://bucket.s3.eu-central-1.amazonaws.com",
      "https://minio.example.com:9443",
    ]);
    expect(parseServerEnv({ ...COMPLETE }).EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS).toEqual([]);

    expect(() =>
      parseServerEnv({
        ...COMPLETE,
        EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS: "http://storage.example.com",
      }),
    ).toThrow(/yalnız güvenli origin/);
    expect(() =>
      parseServerEnv({
        ...COMPLETE,
        EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS: "https://storage.example.com/private",
      }),
    ).toThrow(/yalnız güvenli origin/);
  });

  it.each([
    "https://@storage.example.com",
    "https://storage.example.com:",
    "https://storage.\nexample.com",
  ])("keeps strict raw-origin syntax aligned for signed downloads: %s", (value) => {
    expect(() => parseServerEnv({ ...COMPLETE, EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS: value })).toThrow(
      EnvValidationError,
    );
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
    expect(() =>
      parseServerEnv({ ...COMPLETE, ADMIN_PUBLIC_ORIGIN: "ftp://admin.iskoala.com" }),
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

  it("refuses to boot without the panel's own origin", () => {
    // Not a formality: `buildSessionCookie` reads this to decide `Secure`, and
    // a wrong answer there is invisible — the browser simply does not store the
    // cookie and nobody can sign in.
    try {
      parseServerEnv({ KOALA_API_BASE_URL: "http://localhost:8080" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as EnvValidationError).issues.join("\n")).toContain("ADMIN_PUBLIC_ORIGIN");
    }
  });

  it("allows plain http only against localhost", () => {
    // Locally the panel is a plain-HTTP process. Anywhere else, plain http
    // would put the session cookie — and with it a staff access token — on the
    // wire in the clear.
    expect(
      parseServerEnv({ ...COMPLETE, ADMIN_PUBLIC_ORIGIN: "http://127.0.0.1:3000" })
        .ADMIN_PUBLIC_ORIGIN,
    ).toBe("http://127.0.0.1:3000");

    expect(() =>
      parseServerEnv({ ...COMPLETE, ADMIN_PUBLIC_ORIGIN: "http://admin.iskoala.com" }),
    ).toThrow(/localhost dışında https/);

    expect(
      parseServerEnv({ ...COMPLETE, ADMIN_PUBLIC_ORIGIN: "https://admin.iskoala.com" })
        .ADMIN_PUBLIC_ORIGIN,
    ).toBe("https://admin.iskoala.com");
  });

  it("has no variable left that a Keycloak would have owned", () => {
    // ADR-0014: the panel boots without an identity provider. A variable that
    // came back would be a dependency coming back with it.
    const env = parseServerEnv({ ...COMPLETE });

    expect(Object.keys(env).filter((key) => /KEYCLOAK|AUTH_SECRET|AUDIENCE/.test(key))).toEqual([]);
  });
});
