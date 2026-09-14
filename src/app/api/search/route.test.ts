import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pageEnvelope } from "../../../../test/fixtures/admin-detail";
import { adminMeSuccessBody, resourceNotFoundBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { StaffAuthError } from "@/server/auth/errors";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { GET } = await import("./route");

/**
 * `/api/search` BFF'i (koala-admin#104): oturumu ister, izinleri `/admin/me`'den
 * çözer, aramayı sunucuda yapar. Tarayıcıya dönen gövdede token yok, backend
 * yolu yok — yalnız panel içi `href`'ler.
 */

const UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

function request(q: string) {
  return new Request(`http://admin.iskoala.test/api/search?q=${encodeURIComponent(q)}`);
}

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(apiUrl("/admin/me"), () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

describe("GET /api/search", () => {
  it("answers 401 with no backend call when there is no session", async () => {
    getKoalaAccessToken.mockRejectedValue(
      new StaffAuthError("SESSION_REQUIRED", "Oturum çerezi yok."),
    );

    const response = await GET(request("ayşe"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ kind: "no-permission" });
  });

  it("runs the UUID path with the resolved permissions and returns the panel href", async () => {
    stubMe(["user.read"]);
    const seen: string[] = [];
    server.use(
      http.get(apiUrl(`/admin/users/${UUID}`), ({ request: upstream }) => {
        seen.push(upstream.headers.get("authorization") ?? "");
        return HttpResponse.json({ ...adminMeSuccessBody, data: { id: UUID } });
      }),
    );

    const response = await GET(request(UUID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "object",
      objectKind: "user",
      href: `/users/${UUID}`,
    });
    expect(seen).toEqual(["Bearer ACCESS-TOKEN"]);
  });

  it("answers not-found as 200 so the palette can say so in place", async () => {
    stubMe(["user.read"]);
    server.use(
      http.get(apiUrl(`/admin/users/${UUID}`), () =>
        HttpResponse.json(resourceNotFoundBody, { status: 404 }),
      ),
    );

    const response = await GET(request(UUID));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "not-found", probed: ["user"] });
  });

  it("returns grouped text results and asks nothing the permission set does not cover", async () => {
    stubMe(["user.read"]);
    server.use(
      http.get(apiUrl("/admin/users"), () =>
        HttpResponse.json(
          pageEnvelope("/admin/users", [
            { id: "u-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
          ]),
        ),
      ),
    );

    const response = await GET(request("ayşe"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ kind: "groups", query: "ayşe" });
    expect(body.groups.map((group: { kind: string }) => group.kind)).toEqual(["user"]);
  });

  it("answers 200 no-permission for a staff member who may read nothing searchable", async () => {
    stubMe(["audit.read"]);

    const response = await GET(request("ayşe"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ kind: "no-permission" });
  });

  it("propagates a backend 429 as 429 rate-limited", async () => {
    stubMe(["user.read"]);
    server.use(
      http.get(apiUrl("/admin/users"), () =>
        HttpResponse.json(
          {
            ...resourceNotFoundBody,
            errorCode: "TOO_MANY_REQUESTS",
            errorCategory: "RATE_LIMITED",
            httpStatus: "429 TOO_MANY_REQUESTS",
          },
          { status: 429 },
        ),
      ),
    );

    const response = await GET(request("ayşe"));

    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ kind: "rate-limited" });
  });
});
