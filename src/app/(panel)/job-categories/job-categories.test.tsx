import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: JobCategoriesPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const CATEGORIES = apiUrl("/admin/job-categories");

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

function watchCategories(rows: unknown[] = [], respond?: () => Response) {
  const seen: { calls: number; authorization: string | null } = {
    calls: 0,
    authorization: null,
  };

  server.use(
    http.get(CATEGORIES, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "İş kategorileri listelendi.",
        httpStatus: "200 OK",
        path: "/admin/job-categories",
        requestId: "rid-categories",
        timeStamp: "2026-09-09T12:00:00.000000000Z",
        data: rows,
      });
    }),
  );

  return seen;
}

const render = async () => renderServerComponent(<JobCategoriesPage />);

describe("the category.manage boundary", () => {
  it("renders 403 and makes zero category requests without the permission", async () => {
    stubMe(["content.moderate"], ["MODERATOR"]);
    const categories = watchCategories([
      { id: "ca000000-0000-4000-8000-000000000001", code: "BARISTA", name: "Barista" },
    ]);

    const html = await render();

    expect(categories.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("İş kategorilerini yönet");
    expect(html).not.toContain("Barista");
  });

  it.each(["OWNER", "CATALOG_EDITOR"])(
    "lets a %s with category.manage use the authenticated management endpoint",
    async (role) => {
      stubMe(["category.manage"], [role]);
      const categories = watchCategories([
        {
          id: "ca000000-0000-4000-8000-000000000001",
          code: "BARISTA",
          name: "Barista",
          requiresInsurance: true,
        },
      ]);

      const html = await render();

      expect(categories.calls).toBe(1);
      expect(categories.authorization).toBe("Bearer ACCESS-TOKEN");
      expect(html).toContain("Barista");
      expect(html).toContain("Kategori ekle");
    },
  );
});

describe("catalogue states", () => {
  it("turns an empty catalogue into a direct create path", async () => {
    stubMe(["category.manage"], ["CATALOG_EDITOR"]);
    watchCategories([]);

    const html = await render();

    expect(html).toContain("Hiç iş kategorisi yok.");
    expect(html).toContain("İlk kategoriyi ekle");
    expect(html).not.toContain("Kategoriler yüklenemedi.");
  });

  it("keeps an API failure distinct and renders its requestId", async () => {
    stubMe(["category.manage"], ["OWNER"]);
    watchCategories([], () =>
      HttpResponse.json(
        {
          success: false,
          message: "Kategori servisi geçici olarak kullanılamıyor.",
          httpStatus: "503 SERVICE_UNAVAILABLE",
          errorCode: "SERVICE_UNAVAILABLE",
          errorCategory: "INTERNAL_ERROR",
          requestId: "rid-category-load",
          path: "/admin/job-categories",
          timeStamp: "2026-09-09T12:00:00.000000000Z",
        },
        { status: 503 },
      ),
    );

    const html = await render();

    expect(html).toContain("Kategoriler yüklenemedi.");
    expect(html).toContain("Kategori servisi geçici olarak kullanılamıyor.");
    expect(html).toContain("SERVICE_UNAVAILABLE");
    expect(html).toContain("rid-category-load");
    expect(html).not.toContain("Hiç iş kategorisi yok.");
  });
});
