import { describe, expect, it } from "vitest";

import { buildSessionCookie, joinSessionCookieChunks } from "./cookies";

describe("buildSessionCookie", () => {
  it("is httpOnly, lax and secure on https", () => {
    // The three flags the issue names. `httpOnly` is the one that matters most:
    // the cookie carries the Keycloak tokens, and the panel's permission set
    // reaches `payout.release`.
    const cookie = buildSessionCookie("https://admin.iskoala.com");

    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe("/");
  });

  it("prefixes the name with __Secure- exactly when the cookie is secure", () => {
    // The prefix is only legal on a secure cookie, and Auth.js applies the same
    // rule — if the two disagree the cookie is written under one name and read
    // under another, which looks like "login silently does nothing".
    expect(buildSessionCookie("https://admin.iskoala.com").name).toBe(
      "__Secure-authjs.session-token",
    );
    expect(buildSessionCookie("http://localhost:3000").name).toBe("authjs.session-token");
  });

  it("drops Secure on localhost, because a Secure cookie over http is not stored at all", () => {
    // Hard-coding `secure: true` would not harden development; it would make
    // local sign-in impossible. `src/env.ts` is what guarantees production is
    // https, by refusing to boot otherwise.
    const cookie = buildSessionCookie("http://localhost:3000");

    expect(cookie.options.secure).toBe(false);
    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
  });
});

describe("joinSessionCookieChunks", () => {
  const NAME = "authjs.session-token";

  it("returns an unchunked cookie as it is", () => {
    expect(joinSessionCookieChunks([{ name: NAME, value: "abc" }], NAME)).toBe("abc");
  });

  it("rejoins chunks in numeric order, not string order", () => {
    // A Keycloak token set pushes the encrypted cookie past 4 KB, so chunking
    // is the normal case rather than the edge case. Sorting `.10` as a string
    // would put it before `.2` and decrypt nothing.
    const chunks = [
      { name: `${NAME}.10`, value: "K" },
      { name: `${NAME}.2`, value: "C" },
      { name: `${NAME}.0`, value: "A" },
      { name: `${NAME}.1`, value: "B" },
    ];

    expect(joinSessionCookieChunks(chunks, NAME)).toBe("ABCK");
  });

  it("ignores unrelated cookies", () => {
    const cookies = [
      { name: "authjs.csrf-token", value: "nope" },
      { name: "other", value: "nope" },
      { name: NAME, value: "yes" },
    ];

    expect(joinSessionCookieChunks(cookies, NAME)).toBe("yes");
  });

  it("is null when the cookie is absent or empty", () => {
    expect(joinSessionCookieChunks([], NAME)).toBeNull();
    expect(joinSessionCookieChunks([{ name: NAME, value: "" }], NAME)).toBeNull();
  });

  it("matches the secure name when that is what was written", () => {
    const secure = "__Secure-authjs.session-token";

    expect(joinSessionCookieChunks([{ name: `${secure}.0`, value: "x" }], secure)).toBe("x");
    // …and does not pick up the secure cookie when asked for the plain one.
    expect(joinSessionCookieChunks([{ name: secure, value: "x" }], NAME)).toBeNull();
  });
});
