import { describe, expect, it } from "vitest";

import {
  buildSessionCookie,
  decodeStaffSession,
  encodeStaffSession,
  type StaffSession,
} from "./cookies";

const SESSION: StaffSession = {
  accessToken: "access.token.value",
  refreshToken: "refresh.token.value",
  accessExpiresAt: 1_800_000_000_000,
  refreshExpiresAt: 1_800_040_000_000,
  mustChangePassword: false,
};

describe("buildSessionCookie", () => {
  it("is httpOnly, lax and secure on https", () => {
    // `httpOnly` is the flag the whole design rests on: the cookie carries a
    // staff access token, and the panel's permission set reaches
    // `payout.release`. Browser JavaScript must never be able to read it.
    const cookie = buildSessionCookie("https://admin.iskoala.com");

    expect(cookie.options.httpOnly).toBe(true);
    expect(cookie.options.sameSite).toBe("lax");
    expect(cookie.options.secure).toBe(true);
    expect(cookie.options.path).toBe("/");
  });

  it("prefixes the name with __Secure- exactly when the cookie is secure", () => {
    // The prefix is only legal on a secure cookie. If the writer and the reader
    // disagree about the name, the cookie is written under one and read under
    // another — which looks like "login silently does nothing".
    expect(buildSessionCookie("https://admin.iskoala.com").name).toBe(
      "__Secure-koala_admin_session",
    );
    expect(buildSessionCookie("http://localhost:3000").name).toBe("koala_admin_session");
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

describe("encode/decode round trip", () => {
  it("returns exactly what went in", () => {
    expect(decodeStaffSession(encodeStaffSession(SESSION))).toEqual(SESSION);
  });

  it("carries mustChangePassword, which nothing else can tell the panel", () => {
    // While the flag is set the backend refuses `/admin/me` too, so the login
    // response is the only place this value can come from and the cookie is the
    // only place it can be kept.
    const encoded = encodeStaffSession({ ...SESSION, mustChangePassword: true });

    expect(decodeStaffSession(encoded)?.mustChangePassword).toBe(true);
  });

  it("produces a value with no cookie-hostile characters in it", () => {
    // base64url, not raw JSON: `{`, `"` and `,` would otherwise have to be
    // quoted, and quoting rules are a good way for a writer and a reader to
    // disagree silently.
    expect(encodeStaffSession(SESSION)).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});

describe("decodeStaffSession fails closed", () => {
  it("is null for anything that is not a session", () => {
    expect(decodeStaffSession(undefined)).toBeNull();
    expect(decodeStaffSession(null)).toBeNull();
    expect(decodeStaffSession("")).toBeNull();
    expect(decodeStaffSession("not-base64url!!")).toBeNull();
    expect(decodeStaffSession(btoa("[1,2,3]"))).toBeNull();
    expect(decodeStaffSession(btoa("null"))).toBeNull();
  });

  it("is null when a required field is missing or the wrong type", () => {
    // A half-decoded session is the quietest way to leave a door open: the
    // caller would get an object, believe there is a session, and send an empty
    // Authorization header.
    const cases = [
      { ...SESSION, accessToken: "" },
      { ...SESSION, refreshToken: undefined },
      { ...SESSION, accessExpiresAt: "yarın" },
      { ...SESSION, refreshExpiresAt: Number.NaN },
    ];

    for (const broken of cases) {
      expect(decodeStaffSession(encodeStaffSession(broken as StaffSession))).toBeNull();
    }
  });

  it("treats an absent mustChangePassword as false, not true", () => {
    // The flag is a signpost, not a gate — the backend holds the gate. Locking
    // everyone into the password screen over a missing field would protect
    // nothing and break the panel.
    const { mustChangePassword: _ignored, ...withoutFlag } = SESSION;
    const encoded = encodeStaffSession(withoutFlag as StaffSession);

    expect(decodeStaffSession(encoded)?.mustChangePassword).toBe(false);
  });
});
