import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allowedSignedDownload } from "./signed-download";

const SIGNED =
  "https://koala-bucket.s3.eu-central-1.amazonaws.com/private/tckk.jpg?X-Amz-Expires=180&X-Amz-Signature=do-not-log";

function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(" "));
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * koala-admin#93: üretimde her kutu "indirilemedi" diyordu ve sunucu tarafında
 * tek satır yoktu. Ret artık nedenini söyler — ama imzayı değil.
 */
describe("allowedSignedDownload", () => {
  it("follows a signed URL whose origin is allowlisted, silently", () => {
    const decision = allowedSignedDownload(SIGNED, [
      "https://koala-bucket.s3.eu-central-1.amazonaws.com",
    ]);

    expect(decision).toEqual({ ok: true, url: SIGNED });
    expect(warnings()).toEqual([]);
  });

  it("logs only the origin and the env key when the origin is not allowlisted", () => {
    const decision = allowedSignedDownload(SIGNED, ["https://storage.koala.test"]);

    expect(decision).toEqual({ ok: false, reason: "origin_not_allowed" });

    const [line, ...rest] = warnings();
    expect(rest).toEqual([]);
    expect(line).toContain(
      "evidence download origin not allowed: https://koala-bucket.s3.eu-central-1.amazonaws.com",
    );
    expect(line).toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
    expect(line).not.toContain("/private/tckk.jpg");
    expect(line).not.toContain("X-Amz-Signature");
    expect(line).not.toContain("do-not-log");
  });

  it("says the allowlist itself is empty rather than blaming the origin", () => {
    const decision = allowedSignedDownload(SIGNED, []);

    expect(decision).toEqual({ ok: false, reason: "not_configured" });

    const [line, ...rest] = warnings();
    expect(rest).toEqual([]);
    expect(line).toContain("evidence download allowlist is empty");
    expect(line).toContain(
      "EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS=https://koala-bucket.s3.eu-central-1.amazonaws.com",
    );
    expect(line).not.toContain("origin not allowed");
    expect(line).not.toContain("X-Amz-Signature");
    expect(line).not.toContain("do-not-log");
  });

  it("reads the allowlist from the environment when none is passed", () => {
    // vitest.config.mts: EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS=https://storage.koala.test
    expect(
      allowedSignedDownload("https://storage.koala.test/private/a.jpg?X-Amz-Signature=s"),
    ).toEqual({
      ok: true,
      url: "https://storage.koala.test/private/a.jpg?X-Amz-Signature=s",
    });
    expect(allowedSignedDownload(SIGNED)).toEqual({ ok: false, reason: "origin_not_allowed" });
  });

  it.each([
    { label: "no Location header", location: null },
    { label: "a relative Location", location: "/private/tckk.jpg" },
    { label: "a Location that is not a URL", location: "not a url" },
  ])("treats $label as an upstream failure without an origin to report", ({ location }) => {
    expect(allowedSignedDownload(location, ["https://storage.koala.test"])).toEqual({
      ok: false,
      reason: "upstream",
    });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("evidence download redirect refused");
  });

  it("refuses a signed URL carrying credentials even when its origin is allowlisted", () => {
    const decision = allowedSignedDownload(
      "https://user:secret-pass@storage.koala.test/private/a.jpg",
      ["https://storage.koala.test"],
    );

    expect(decision).toEqual({ ok: false, reason: "upstream" });
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("carries credentials");
    expect(warnings()[0]).not.toContain("secret-pass");
  });
});
