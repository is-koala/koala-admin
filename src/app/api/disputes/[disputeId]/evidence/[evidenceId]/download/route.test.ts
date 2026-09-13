import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../../../../../../test/msw";
import { StaffAuthError } from "@/server/auth/errors";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

/**
 * vitest.config.mts listeyi dolu verir (`https://storage.koala.test`); boş
 * listeyi — üretimde #93'ü üreten hâl — testin kendisi seçer.
 */
const allowlist = vi.hoisted(() => ({ origins: ["https://storage.koala.test"] }));

vi.mock("@/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS() {
        return allowlist.origins;
      },
    },
  };
});

const { GET } = await import("./route");

const DISPUTE_ID = "d1000000-0000-4c00-8000-000000000001";
const EVIDENCE_ID = "e1000000-0000-4c00-8000-000000000001";
const EVIDENCE_PATH = `/admin/disputes/${DISPUTE_ID}/evidence`;
const DOWNLOAD_PATH = `${EVIDENCE_PATH}/${EVIDENCE_ID}/download`;

function evidenceEnvelope(fileName: string) {
  return {
    success: true,
    message: "Kanıtlar listelendi.",
    httpStatus: "200 OK",
    path: EVIDENCE_PATH,
    requestId: "rid-evidence",
    timeStamp: "2026-09-09T06:00:00.000000000Z",
    data: [
      {
        id: EVIDENCE_ID,
        disputeId: DISPUTE_ID,
        uploadedBy: {
          id: "w-1",
          firstName: "Ayşe",
          lastName: "Yılmaz",
          username: "ayse",
          profilePictureUrl: null,
        },
        uploaderSide: "WORKER",
        fileName,
        contentType: "image/png",
        fileSize: 3,
        checksumSha256: "a".repeat(64),
        createdAt: "2026-09-09T05:55:00.000000000Z",
      },
    ],
  };
}

function request() {
  return new Request(
    `http://admin.iskoala.test/api/disputes/${DISPUTE_ID}/evidence/${EVIDENCE_ID}/download`,
  );
}

function context(
  params: { disputeId: string; evidenceId: string } = {
    disputeId: DISPUTE_ID,
    evidenceId: EVIDENCE_ID,
  },
) {
  return { params: Promise.resolve(params) };
}

function errorEnvelope(status: number, errorCode: string, errorCategory: string) {
  return {
    success: false,
    message: "Kanıt bulunamadı.",
    httpStatus: `${status}`,
    errorCode,
    errorCategory,
    requestId: "rid-concealed",
    path: EVIDENCE_PATH,
    timeStamp: "2026-09-09T06:00:00.000000000Z",
  };
}

async function concealedShape(response: Response) {
  return {
    status: response.status,
    body: await response.text(),
    contentType: response.headers.get("content-type"),
    cacheControl: response.headers.get("cache-control"),
    contentTypeOptions: response.headers.get("x-content-type-options"),
  };
}

beforeEach(() => {
  allowlist.origins = ["https://storage.koala.test"];
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

function warnings(): string[] {
  return vi.mocked(console.warn).mock.calls.map((call) => call.map(String).join(" "));
}

afterEach(() => {
  getKoalaAccessToken.mockReset();
  vi.restoreAllMocks();
});

describe("the same-origin evidence download route", () => {
  it("streams a local backend response as a safely named attachment", async () => {
    const authorizations: Array<string | null> = [];
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), ({ request: backendRequest }) => {
        authorizations.push(backendRequest.headers.get("authorization"));
        return HttpResponse.json(evidenceEnvelope('../../Özgeçmiş\r\nX-Evil: "yes".png'));
      }),
      http.get(apiUrl(DOWNLOAD_PATH), ({ request: backendRequest }) => {
        authorizations.push(backendRequest.headers.get("authorization"));
        return new HttpResponse(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "3",
            "content-disposition": "inline",
          },
        });
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(authorizations).toEqual(["Bearer ACCESS-TOKEN", "Bearer ACCESS-TOKEN"]);

    const disposition = response.headers.get("content-disposition") ?? "";
    expect(disposition).toMatch(/^attachment;/);
    expect(disposition).not.toContain("inline");
    expect(disposition).not.toMatch(/[\\/\r\n]/);
    expect(disposition).not.toContain("..");
    expect(disposition).toContain("filename*=UTF-8''");

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("location")).toBeNull();
    expect([...response.headers.values()].join(" ")).not.toContain("ACCESS-TOKEN");
    expect([...response.headers.values()].join(" ")).not.toContain("koala-backend.test");
  });

  it("keeps long astral Unicode names well-formed at the truncation boundary", async () => {
    const fileName = `${"a".repeat(179)}😀.png`;
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope(fileName))),
      http.get(
        apiUrl(DOWNLOAD_PATH),
        () =>
          new HttpResponse(Uint8Array.from([1]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );

    const response = await GET(request(), context());
    const disposition = response.headers.get("content-disposition") ?? "";

    expect(response.status).toBe(200);
    expect(disposition).toMatch(/^attachment;/);
    expect(() => decodeURIComponent(disposition)).not.toThrow();
  });

  it("removes Unicode bidi controls from the attachment name", async () => {
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () =>
        HttpResponse.json(evidenceEnvelope("foto\u202Egnp.png")),
      ),
      http.get(
        apiUrl(DOWNLOAD_PATH),
        () =>
          new HttpResponse(Uint8Array.from([1]), {
            status: 200,
            headers: { "content-type": "image/png" },
          }),
      ),
    );

    const response = await GET(request(), context());
    const disposition = response.headers.get("content-disposition") ?? "";

    expect(response.status).toBe(200);
    expect(disposition).not.toContain("%E2%80%AE");
    expect(decodeURIComponent(disposition)).not.toContain("\u202E");
  });

  it("server-follows an allowlisted signed redirect without forwarding privileged headers", async () => {
    const signedUrl =
      "https://storage.koala.test/private/evidence.png?X-Amz-Expires=180&X-Amz-Signature=secret";
    let storageCalls = 0;
    let storageHeaders: Headers | null = null;
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(apiUrl(DOWNLOAD_PATH), ({ request: backendRequest }) => {
        expect(backendRequest.headers.get("authorization")).toBe("Bearer ACCESS-TOKEN");
        return new HttpResponse(null, {
          status: 302,
          headers: { location: signedUrl, "cache-control": "no-store" },
        });
      }),
      http.get("https://storage.koala.test/private/evidence.png", ({ request: storageRequest }) => {
        storageCalls += 1;
        storageHeaders = storageRequest.headers;
        return new HttpResponse(Uint8Array.from([9, 8, 7]), {
          status: 200,
          headers: {
            "content-type": "image/png",
            "content-length": "3",
            "content-disposition": "inline; filename=untrusted.png",
          },
        });
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect(storageCalls).toBe(1);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([9, 8, 7]);
    expect((storageHeaders as Headers | null)?.get("authorization")).toBeNull();
    expect((storageHeaders as Headers | null)?.get("cookie")).toBeNull();
    expect((storageHeaders as Headers | null)?.get("accept-language")).toBeNull();
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-disposition")).toContain("vardiya.png");
    expect([...response.headers.values()].join(" ")).not.toContain("storage.koala.test");
    expect([...response.headers.values()].join(" ")).not.toContain("X-Amz-Signature");
  });

  it("refuses a signed redirect whose origin is not explicitly allowlisted", async () => {
    const unsafe = "https://attacker.test/evidence.png?X-Amz-Signature=do-not-follow";
    let attackerCalls = 0;
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(
        apiUrl(DOWNLOAD_PATH),
        () => new HttpResponse(null, { status: 302, headers: { location: unsafe } }),
      ),
      http.get("https://attacker.test/evidence.png", () => {
        attackerCalls += 1;
        return new HttpResponse(Uint8Array.from([6, 6, 6]));
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(502);
    expect(attackerCalls).toBe(0);
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("x-koala-download-error")).toBe("origin_not_allowed");
    expect(await response.text()).toBe("Kanıt dosyası indirilemedi.");
    expect([...response.headers.values()].join(" ")).not.toContain("X-Amz-Signature");
    expect([...response.headers.values()].join(" ")).not.toContain("attacker.test");

    // koala-admin#93: ret sunucu günlüğüne düşer — yalnız origin, imza değil.
    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("evidence download origin not allowed: https://attacker.test");
    expect(warnings()[0]).toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
    expect(warnings()[0]).not.toContain("do-not-follow");
    expect(warnings()[0]).not.toContain("/evidence.png");
  });

  it("says the allowlist is empty, in the header and the log, when nothing is configured", async () => {
    allowlist.origins = [];
    const signedUrl =
      "https://storage.koala.test/private/evidence.png?X-Amz-Signature=do-not-follow";
    let storageCalls = 0;
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(
        apiUrl(DOWNLOAD_PATH),
        () => new HttpResponse(null, { status: 302, headers: { location: signedUrl } }),
      ),
      http.get("https://storage.koala.test/private/evidence.png", () => {
        storageCalls += 1;
        return new HttpResponse(Uint8Array.from([6, 6, 6]));
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(502);
    expect(storageCalls).toBe(0);
    expect(response.headers.get("x-koala-download-error")).toBe("not_configured");
    expect(await response.text()).toBe("Kanıt dosyası indirilemedi.");
    expect([...response.headers.values()].join(" ")).not.toContain("storage.koala.test");

    expect(warnings()).toHaveLength(1);
    expect(warnings()[0]).toContain("evidence download allowlist is empty");
    expect(warnings()[0]).toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS=https://storage.koala.test");
    expect(warnings()[0]).not.toContain("do-not-follow");
  });

  it("marks a storage that did not answer 200 as an upstream failure, not a configuration one", async () => {
    const signedUrl = "https://storage.koala.test/private/evidence.png?X-Amz-Signature=secret";
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(
        apiUrl(DOWNLOAD_PATH),
        () => new HttpResponse(null, { status: 302, headers: { location: signedUrl } }),
      ),
      http.get(
        "https://storage.koala.test/private/evidence.png",
        () => new HttpResponse("<Error>AccessDenied</Error>", { status: 403 }),
      ),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(502);
    expect(response.headers.get("x-koala-download-error")).toBe("upstream");
    expect(await response.text()).toBe("Kanıt dosyası indirilemedi.");
    expect(warnings()).toEqual([]);
  });

  it("marks a backend that is down as an upstream failure too", async () => {
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(apiUrl(DOWNLOAD_PATH), () => HttpResponse.error()),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(502);
    expect(response.headers.get("x-koala-download-error")).toBe("upstream");
  });

  it("sends no reason header on the concealed 404", async () => {
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(apiUrl(DOWNLOAD_PATH), () => new HttpResponse(null, { status: 404 })),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(404);
    expect(response.headers.get("x-koala-download-error")).toBeNull();
  });

  it("makes a missing file and a permission denial indistinguishable", async () => {
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () =>
        HttpResponse.json(errorEnvelope(404, "DISPUTE_NOT_FOUND", "RESOURCE_NOT_FOUND"), {
          status: 404,
        }),
      ),
    );
    const absent = await concealedShape(await GET(request(), context()));

    server.resetHandlers();
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => HttpResponse.json(evidenceEnvelope("vardiya.png"))),
      http.get(apiUrl(DOWNLOAD_PATH), () =>
        HttpResponse.json(errorEnvelope(403, "ACCESS_DENIED", "ACCESS_DENIED"), { status: 403 }),
      ),
    );
    const denied = await concealedShape(await GET(request(), context()));

    expect(absent).toEqual({
      status: 404,
      body: "Kanıt bulunamadı.",
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
      contentTypeOptions: "nosniff",
    });
    expect(denied).toEqual(absent);
    expect(JSON.stringify(denied)).not.toContain("ACCESS_DENIED");
  });

  it("conceals the route when no staff session can supply a token", async () => {
    getKoalaAccessToken.mockRejectedValueOnce(new StaffAuthError("SESSION_REQUIRED"));

    const response = await GET(request(), context());

    expect(await concealedShape(response)).toEqual({
      status: 404,
      body: "Kanıt bulunamadı.",
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
      contentTypeOptions: "nosniff",
    });
  });

  it("conceals malformed identifiers before making a backend request", async () => {
    let backendCalls = 0;
    server.use(
      http.get(apiUrl(EVIDENCE_PATH), () => {
        backendCalls += 1;
        return HttpResponse.json(evidenceEnvelope("vardiya.png"));
      }),
    );

    const response = await GET(
      request(),
      context({ disputeId: "../not-a-uuid", evidenceId: EVIDENCE_ID }),
    );

    expect(response.status).toBe(404);
    expect(backendCalls).toBe(0);
  });
});
