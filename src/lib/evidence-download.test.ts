import { describe, expect, it, vi } from "vitest";

import {
  classifyDownloadResponse,
  diagnoseDownload,
  DOWNLOAD_ERROR_HEADER,
  parseDownloadErrorReason,
  PHOTO_LOAD_FAILURE_TEXT,
} from "./evidence-download";

describe("classifyDownloadResponse", () => {
  it.each([
    { status: 404, header: null, expected: "not_found" },
    { status: 502, header: "not_configured", expected: "not_configured" },
    { status: 502, header: "origin_not_allowed", expected: "origin_not_allowed" },
    { status: 502, header: "upstream", expected: "upstream" },
    // Başlıksız 502 BFF'den değil önündeki proxy'den gelmiş olabilir.
    { status: 502, header: null, expected: "unknown" },
    { status: 502, header: "something-new", expected: "unknown" },
    { status: 500, header: "upstream", expected: "unknown" },
    { status: 200, header: null, expected: "unknown" },
  ] as const)("maps $status + $header to $expected", ({ status, header, expected }) => {
    expect(classifyDownloadResponse(status, header)).toBe(expected);
  });

  it("does not trust an arbitrary header value as a reason", () => {
    expect(parseDownloadErrorReason("constructor")).toBeNull();
    expect(parseDownloadErrorReason("")).toBeNull();
    expect(parseDownloadErrorReason(null)).toBeNull();
  });
});

describe("the operator-facing sentences", () => {
  it("keep 404 and the two 502 causes apart and name the env key", () => {
    const sentences = new Set(Object.values(PHOTO_LOAD_FAILURE_TEXT));

    expect(sentences.size).toBe(Object.keys(PHOTO_LOAD_FAILURE_TEXT).length);
    expect(PHOTO_LOAD_FAILURE_TEXT.not_configured).toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
    expect(PHOTO_LOAD_FAILURE_TEXT.origin_not_allowed).toContain(
      "EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS",
    );
    expect(PHOTO_LOAD_FAILURE_TEXT.not_found).not.toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
    expect(PHOTO_LOAD_FAILURE_TEXT.upstream).not.toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
  });
});

describe("diagnoseDownload", () => {
  it("asks the same address with HEAD and reads the reason header", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(null, { status: 502, headers: { [DOWNLOAD_ERROR_HEADER]: "not_configured" } }),
      );

    await expect(diagnoseDownload("/api/x/download", fetchImpl)).resolves.toBe("not_configured");

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    expect(url).toBe("/api/x/download");
    expect(init).toMatchObject({ method: "HEAD", cache: "no-store", credentials: "same-origin" });
  });

  it("falls back to the generic failure when the diagnosis request itself fails", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Failed to fetch"));

    await expect(diagnoseDownload("/api/x/download", fetchImpl)).resolves.toBe("unknown");
  });
});
