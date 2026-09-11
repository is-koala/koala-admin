import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { apiUrl, server } from "../../../test/msw";
import {
  authenticationRequiredBody,
  jobCategoriesSuccessBody,
  validationFailedBody,
} from "../../../test/fixtures/envelopes";

import { KoalaApiError } from "./errors";
import { buildKoalaHeaders, buildKoalaUrl, koalaApi, koalaRequest } from "./koala";

const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  requiresInsurance: z.boolean(),
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Silences the failure log line and hands back what was written to it. */
function captureErrorLog(): { lines: string[] } {
  const lines: string[] = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return { lines };
}

describe("buildKoalaUrl", () => {
  it.each([
    {
      path: "/reference/job-categories",
      expected: "http://koala-backend.test/reference/job-categories",
    },
    {
      path: "reference/job-categories",
      expected: "http://koala-backend.test/reference/job-categories",
    },
    { path: "/admin/me", expected: "http://koala-backend.test/admin/me" },
  ])("joins the backend root and $path", ({ path, expected }) => {
    expect(buildKoalaUrl(path)).toBe(expected);
  });

  it.each([
    {
      configuredRoot: "  HTTP://KOALA-BACKEND.TEST:8080/  ",
      path: "/admin/me",
      expected: "http://koala-backend.test:8080/admin/me",
    },
    {
      configuredRoot: "HTTPS://API.ISKOALA.COM:8443/",
      path: "admin/disputes",
      expected: "https://api.iskoala.com:8443/admin/disputes",
    },
  ])(
    "joins a canonicalised $configuredRoot without losing its port",
    async ({ configuredRoot, path, expected }) => {
      vi.stubEnv("KOALA_API_BASE_URL", configuredRoot);
      vi.resetModules();

      try {
        const { buildKoalaUrl: buildWithConfiguredRoot } = await import("./koala");
        expect(buildWithConfiguredRoot(path)).toBe(expected);
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    },
  );

  it("drops null and undefined query values instead of sending 'null'", () => {
    expect(buildKoalaUrl("/admin/jobs", { page: 0, size: 20, status: null, q: undefined })).toBe(
      "http://koala-backend.test/admin/jobs?page=0&size=20",
    );
  });
});

describe("buildKoalaHeaders", () => {
  it("sends Accept-Language: tr and nothing device-shaped", () => {
    const headers = buildKoalaHeaders({});

    expect(headers.get("Accept-Language")).toBe("tr");
    expect(headers.get("Accept")).toBe("application/json");
    expect(headers.get("Authorization")).toBeNull();
    expect([...headers.keys()].sort()).toEqual(["accept", "accept-language"]);
  });

  it("adds the bearer token and content type only when they apply", () => {
    const headers = buildKoalaHeaders({ accessToken: "abc.def.ghi", hasJsonBody: true });

    expect(headers.get("Authorization")).toBe("Bearer abc.def.ghi");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("ignores an empty token rather than sending 'Bearer '", () => {
    expect(buildKoalaHeaders({ accessToken: "" }).get("Authorization")).toBeNull();
    expect(buildKoalaHeaders({ accessToken: null }).get("Authorization")).toBeNull();
  });
});

describe("koalaRequest", () => {
  it("unwraps a SuccessDataResult and validates the payload", async () => {
    server.use(
      http.get(apiUrl("/reference/job-categories"), () =>
        HttpResponse.json(jobCategoriesSuccessBody),
      ),
    );

    const categories = await koalaApi.get({
      path: "/reference/job-categories",
      schema: z.array(categorySchema),
    });

    expect(categories.map((category) => category.code)).toEqual([
      "BARISTA",
      "PHOTOGRAPHY",
      "WAITER",
    ]);
  });

  it("sends exactly the headers the panel is allowed to send", async () => {
    let sent: Headers | undefined;
    server.use(
      http.get(apiUrl("/reference/job-categories"), ({ request }) => {
        sent = request.headers;
        return HttpResponse.json(jobCategoriesSuccessBody);
      }),
    );

    await koalaApi.get({
      path: "/reference/job-categories",
      schema: z.array(categorySchema),
      accessToken: "token-123",
    });

    expect(sent?.get("accept-language")).toBe("tr");
    expect(sent?.get("authorization")).toBe("Bearer token-123");
    // The two headers the issue forbids. `MinimumAppVersionFilter` waves a
    // request through when they are absent, and `/admin/**` is moving to its
    // own filter chain, so sending them would only opt the panel into a
    // version gate written for the mobile client.
    expect(sent?.get("x-device-id")).toBeNull();
    expect(sent?.get("x-app-version")).toBeNull();
  });

  it("serialises a JSON body for a write", async () => {
    let received: unknown;
    server.use(
      http.post(apiUrl("/admin/job-categories"), async ({ request }) => {
        received = await request.json();
        return HttpResponse.json({
          ...jobCategoriesSuccessBody,
          data: { ok: true },
        });
      }),
    );

    await koalaApi.post({
      path: "/admin/job-categories",
      body: { name: "Barista", code: "BARISTA" },
      schema: z.object({ ok: z.boolean() }),
      accessToken: "token-123",
    });

    expect(received).toEqual({ name: "Barista", code: "BARISTA" });
  });

  it("throws a typed KoalaApiError, preserving code, category and details", async () => {
    captureErrorLog();
    server.use(
      http.post(apiUrl("/admin/job-categories"), () =>
        HttpResponse.json(validationFailedBody, { status: 400 }),
      ),
    );

    const error = await koalaApi
      .post({
        path: "/admin/job-categories",
        body: {},
        schema: z.unknown(),
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KoalaApiError);
    const koala = error as KoalaApiError;
    expect(koala.status).toBe(400);
    expect(koala.errorCode).toBe("JOB_CATEGORY_INVALID");
    expect(koala.errorCategory).toBe("VALIDATION_FAILED");
    expect(koala.message).toBe("Doğrulama başarısız.");
    expect(koala.details).toEqual([
      { field: "name", message: "Ad boş olamaz." },
      { field: "code", message: "Kod benzersiz olmalı." },
    ]);
  });

  it("logs one line carrying the request id", async () => {
    const log = captureErrorLog();
    server.use(
      http.get(apiUrl("/admin/job-categories"), () =>
        HttpResponse.json(authenticationRequiredBody, { status: 401 }),
      ),
    );

    await koalaApi
      .get({ path: "/admin/job-categories", schema: z.unknown() })
      .catch(() => undefined);

    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toContain("requestId=47d40e1a-fabf-46d3-90e2-3d28f3d4476e");
    expect(log.lines[0]).toContain("category=AUTHENTICATION_REQUIRED");
    expect(log.lines[0]).toContain("status=401");
  });

  it("turns a transport failure into a KoalaApiError rather than a raw fetch error", async () => {
    const log = captureErrorLog();
    server.use(http.get(apiUrl("/reference/job-categories"), () => HttpResponse.error()));

    const error = await koalaRequest({
      path: "/reference/job-categories",
      schema: z.unknown(),
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KoalaApiError);
    const koala = error as KoalaApiError;
    expect(koala.status).toBe(0);
    expect(koala.errorCategory).toBe("UPSTREAM_FAILED");
    expect(koala.errorCode).toBe("NETWORK_FAILURE");
    // No response, so no id exists; the log still has the field, marked absent.
    expect(koala.requestId).toBeNull();
    expect(log.lines[0]).toContain("requestId=-");
  });

  it("aborts a request that outlives its timeout", async () => {
    captureErrorLog();
    server.use(
      http.get(apiUrl("/reference/job-categories"), async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        return HttpResponse.json(jobCategoriesSuccessBody);
      }),
    );

    const error = await koalaRequest({
      path: "/reference/job-categories",
      schema: z.unknown(),
      timeoutMs: 20,
    }).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(KoalaApiError);
    expect((error as KoalaApiError).errorCode).toBe("REQUEST_TIMEOUT");
  });

  it("rejects a 200 whose body drifted from the caller's schema", async () => {
    captureErrorLog();
    server.use(
      http.get(apiUrl("/reference/job-categories"), () =>
        HttpResponse.json({
          ...jobCategoriesSuccessBody,
          data: [{ id: "1", name: "Barista" }],
        }),
      ),
    );

    const error = await koalaRequest({
      path: "/reference/job-categories",
      schema: z.array(categorySchema),
    }).catch((caught: unknown) => caught);

    expect((error as KoalaApiError).errorCode).toBe("RESPONSE_SCHEMA_MISMATCH");
  });

  it("sends a multipart body without inventing application/json", async () => {
    let contentType: string | null = "unset";
    let partName: string | null = null;
    let fileName: string | null = null;
    let authorization: string | null = null;

    server.use(
      http.put(
        apiUrl("/admin/badges/ba000000-0000-4000-8000-000000000001/icon"),
        async ({ request }) => {
          contentType = request.headers.get("content-type");
          authorization = request.headers.get("authorization");
          const incoming = await request.formData();
          const icon = incoming.get("icon");
          partName = incoming.has("icon") ? "icon" : null;
          fileName = icon instanceof File ? icon.name : null;
          return HttpResponse.json({
            success: true,
            message: "Rozet görseli güncellendi.",
            httpStatus: "200 OK",
            path: "/admin/badges/ba000000-0000-4000-8000-000000000001/icon",
            requestId: "rid-icon",
            timeStamp: "2026-09-11T12:00:00.000000000Z",
            data: { ok: true },
          });
        },
      ),
    );

    const body = new FormData();
    body.set("icon", new File([new Uint8Array([137, 80, 78])], "rozet.png", { type: "image/png" }));

    await koalaApi.put({
      path: "/admin/badges/ba000000-0000-4000-8000-000000000001/icon",
      body,
      schema: z.object({ ok: z.boolean() }),
      accessToken: "token-123",
    });

    expect(authorization).toBe("Bearer token-123");
    expect(contentType).toMatch(/multipart\/form-data/i);
    expect(contentType).not.toContain("application/json");
    expect(partName).toBe("icon");
    expect(fileName).toBe("rozet.png");
  });
});
