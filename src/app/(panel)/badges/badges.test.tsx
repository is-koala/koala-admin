import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: BadgesPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const BADGES = apiUrl("/admin/badges");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions], roles: [...roles] },
      }),
    ),
  );
}

function watchBadges(rows: unknown[] = [], respond?: () => Response) {
  const seen: { calls: number; authorization: string | null } = {
    calls: 0,
    authorization: null,
  };

  server.use(
    http.get(BADGES, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Rozetler listelendi.",
        httpStatus: "200 OK",
        path: "/admin/badges",
        requestId: "rid-badges",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: rows,
      });
    }),
  );

  return seen;
}

const render = async () => renderServerComponent(<BadgesPage />);

describe("the badge.manage boundary", () => {
  it("renders 403 and makes zero badge requests without the permission", async () => {
    stubMe(["category.manage"], ["CATALOG_EDITOR"]);
    const badges = watchBadges([
      {
        id: "ba000000-0000-4000-8000-000000000001",
        code: "GEZGIN_SILVER",
        family: "GEZGIN",
        tier: "SILVER",
        name: "Gezgin Gümüş",
        description: null,
        iconUrl: null,
        sortOrder: 10,
        ruleType: "COMPLETED_ASSIGNMENTS",
        minCount: 5,
        minAverageRating: null,
        minReviewCount: null,
        active: true,
      },
    ]);

    const html = await render();

    expect(badges.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Rozetleri yönet");
    expect(html).not.toContain("Gezgin Gümüş");
  });

  it("lets a holder of badge.manage use the authenticated management endpoint", async () => {
    stubMe(["badge.manage"], ["OWNER"]);
    const badges = watchBadges([
      {
        id: "ba000000-0000-4000-8000-000000000001",
        code: "GEZGIN_SILVER",
        family: "GEZGIN",
        tier: "SILVER",
        name: "Gezgin Gümüş",
        description: "5 tamamlanmış iş.",
        iconUrl: null,
        sortOrder: 10,
        ruleType: "COMPLETED_ASSIGNMENTS",
        minCount: 5,
        minAverageRating: null,
        minReviewCount: null,
        active: true,
      },
    ]);

    const html = await render();

    expect(badges.calls).toBe(1);
    expect(badges.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).toContain("Gezgin Gümüş");
    expect(html).toContain("Rozet ekle");
  });
});

describe("catalogue states", () => {
  it("turns an empty catalogue into a direct create path", async () => {
    stubMe(["badge.manage"], ["OWNER"]);
    watchBadges([]);

    const html = await render();

    expect(html).toContain("Hiç rozet yok.");
    expect(html).toContain("İlk rozeti ekle");
    expect(html).not.toContain("Rozetler yüklenemedi.");
  });

  it("keeps an API failure distinct and renders its requestId", async () => {
    stubMe(["badge.manage"], ["OWNER"]);
    watchBadges([], () =>
      HttpResponse.json(
        {
          success: false,
          message: "Rozet servisi geçici olarak kullanılamıyor.",
          httpStatus: "503 SERVICE_UNAVAILABLE",
          errorCode: "SERVICE_UNAVAILABLE",
          errorCategory: "INTERNAL_ERROR",
          requestId: "rid-badge-load",
          path: "/admin/badges",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
        },
        { status: 503 },
      ),
    );

    const html = await render();

    expect(html).toContain("Rozetler yüklenemedi.");
    expect(html).toContain("Rozet servisi geçici olarak kullanılamıyor.");
    expect(html).toContain("SERVICE_UNAVAILABLE");
    expect(html).toContain("rid-badge-load");
    expect(html).not.toContain("Hiç rozet yok.");
  });
});
