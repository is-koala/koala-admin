import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../../../../../../test/msw";
import { StaffAuthError } from "@/server/auth/errors";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { GET } = await import("./route");

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "c3000000-0000-4000-8000-000000000003";
const DOWNLOAD_PATH = `/admin/identity-verifications/${REVIEW_ID}/documents/${DOCUMENT_ID}/download`;

function request() {
  return new Request(
    `http://admin.iskoala.test/api/identity-verifications/${REVIEW_ID}/documents/${DOCUMENT_ID}/download`,
  );
}

function context(
  params: { reviewId: string; documentId: string } = {
    reviewId: REVIEW_ID,
    documentId: DOCUMENT_ID,
  },
) {
  return { params: Promise.resolve(params) };
}

function errorEnvelope(status: number, errorCode: string, errorCategory: string) {
  return {
    success: false,
    message: "Belge bulunamadı.",
    httpStatus: `${status}`,
    errorCode,
    errorCategory,
    requestId: "rid-concealed",
    path: DOWNLOAD_PATH,
    timeStamp: "2026-09-11T12:00:00.000000000Z",
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
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  getKoalaAccessToken.mockReset();
  vi.restoreAllMocks();
});

describe("the same-origin identity document download route", () => {
  it("streams a local backend response as same-origin image bytes", async () => {
    const authorizations: Array<string | null> = [];
    server.use(
      http.get(apiUrl(DOWNLOAD_PATH), ({ request: backendRequest }) => {
        authorizations.push(backendRequest.headers.get("authorization"));
        return new HttpResponse(Uint8Array.from([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": "3",
            "content-disposition": "attachment; filename=on.jpg",
          },
        });
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(200);
    expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2, 3]);
    expect(authorizations).toEqual(["Bearer ACCESS-TOKEN"]);

    expect(response.headers.get("content-type")).toBe("image/jpeg");
    expect(response.headers.get("content-length")).toBe("3");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow, noarchive");
    expect(response.headers.get("location")).toBeNull();
    expect(response.headers.get("content-disposition") ?? "").toMatch(/^inline;/);
    expect([...response.headers.values()].join(" ")).not.toContain("ACCESS-TOKEN");
    expect([...response.headers.values()].join(" ")).not.toContain("koala-backend.test");
  });

  it("server-follows an allowlisted signed redirect without forwarding privileged headers", async () => {
    const signedUrl =
      "https://storage.koala.test/private/tckk.jpg?X-Amz-Expires=180&X-Amz-Signature=secret";
    let storageCalls = 0;
    let storageHeaders: Headers | null = null;
    server.use(
      http.get(apiUrl(DOWNLOAD_PATH), ({ request: backendRequest }) => {
        expect(backendRequest.headers.get("authorization")).toBe("Bearer ACCESS-TOKEN");
        return new HttpResponse(null, {
          status: 302,
          headers: { location: signedUrl, "cache-control": "no-store" },
        });
      }),
      http.get("https://storage.koala.test/private/tckk.jpg", ({ request: storageRequest }) => {
        storageCalls += 1;
        storageHeaders = storageRequest.headers;
        return new HttpResponse(Uint8Array.from([9, 8, 7]), {
          status: 200,
          headers: {
            "content-type": "image/jpeg",
            "content-length": "3",
            "content-disposition": "inline; filename=untrusted.jpg",
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
    expect([...response.headers.values()].join(" ")).not.toContain("storage.koala.test");
    expect([...response.headers.values()].join(" ")).not.toContain("X-Amz-Signature");
  });

  it("refuses a signed redirect whose origin is not explicitly allowlisted", async () => {
    const unsafe = "https://attacker.test/tckk.jpg?X-Amz-Signature=do-not-follow";
    let attackerCalls = 0;
    server.use(
      http.get(
        apiUrl(DOWNLOAD_PATH),
        () => new HttpResponse(null, { status: 302, headers: { location: unsafe } }),
      ),
      http.get("https://attacker.test/tckk.jpg", () => {
        attackerCalls += 1;
        return new HttpResponse(Uint8Array.from([6, 6, 6]));
      }),
    );

    const response = await GET(request(), context());

    expect(response.status).toBe(502);
    expect(attackerCalls).toBe(0);
    expect(response.headers.get("location")).toBeNull();
    expect(await response.text()).not.toContain("attacker.test");
    expect([...response.headers.values()].join(" ")).not.toContain("X-Amz-Signature");
  });

  it("makes a missing file and a permission denial indistinguishable", async () => {
    server.use(
      http.get(apiUrl(DOWNLOAD_PATH), () =>
        HttpResponse.json(errorEnvelope(404, "IDENTITY_DOCUMENT_NOT_FOUND", "RESOURCE_NOT_FOUND"), {
          status: 404,
        }),
      ),
    );
    const absent = await concealedShape(await GET(request(), context()));

    server.resetHandlers();
    server.use(
      http.get(apiUrl(DOWNLOAD_PATH), () =>
        HttpResponse.json(errorEnvelope(403, "ACCESS_DENIED", "ACCESS_DENIED"), { status: 403 }),
      ),
    );
    const denied = await concealedShape(await GET(request(), context()));

    expect(absent).toEqual({
      status: 404,
      body: "Kimlik fotoğrafı bulunamadı.",
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
      contentTypeOptions: "nosniff",
    });
    expect(denied).toEqual(absent);
    expect(JSON.stringify(denied)).not.toContain("ACCESS_DENIED");
    expect(JSON.stringify(absent)).not.toContain("IDENTITY_DOCUMENT_NOT_FOUND");
  });

  it("conceals the route when no staff session can supply a token", async () => {
    getKoalaAccessToken.mockRejectedValueOnce(new StaffAuthError("SESSION_REQUIRED"));

    const response = await GET(request(), context());

    expect(await concealedShape(response)).toEqual({
      status: 404,
      body: "Kimlik fotoğrafı bulunamadı.",
      contentType: "text/plain; charset=utf-8",
      cacheControl: "no-store",
      contentTypeOptions: "nosniff",
    });
  });

  it("conceals malformed identifiers before making a backend request", async () => {
    let backendCalls = 0;
    server.use(
      http.get(apiUrl(DOWNLOAD_PATH), () => {
        backendCalls += 1;
        return new HttpResponse(Uint8Array.from([1]));
      }),
    );

    const response = await GET(
      request(),
      context({ reviewId: "../not-a-uuid", documentId: DOCUMENT_ID }),
    );

    expect(response.status).toBe(404);
    expect(backendCalls).toBe(0);
  });
});
