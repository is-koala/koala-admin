import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: SettingsPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const SETTINGS = apiUrl("/admin/settings");

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

function watchSettings(rows: unknown[] = [], respond?: () => Response) {
  const seen: { calls: number; authorization: string | null } = {
    calls: 0,
    authorization: null,
  };

  server.use(
    http.get(SETTINGS, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Ayarlar listelendi.",
        httpStatus: "200 OK",
        path: "/admin/settings",
        requestId: "rid-settings",
        timeStamp: "2026-09-11T08:00:00.000000000Z",
        data: rows,
      });
    }),
  );

  return seen;
}

const render = async () => renderServerComponent(<SettingsPage />);

describe("the settings.manage boundary", () => {
  it("renders 403 and makes zero settings requests without the permission", async () => {
    stubMe(["category.manage"], ["CATALOG_EDITOR"]);
    const settings = watchSettings([
      {
        key: "commission.rate",
        value: "0.10",
        description: "gizli",
        updatedAt: "2026-09-11T08:00:00Z",
      },
    ]);

    const html = await render();

    expect(settings.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Ayarları yönet");
    expect(html).not.toContain("commission.rate");
  });

  it("lets an OWNER with settings.manage use the authenticated management endpoint", async () => {
    stubMe(["settings.manage"], ["OWNER"]);
    const settings = watchSettings([
      {
        key: "commission.rate",
        value: "0.10",
        description: "İşveren ücretine eklenen hizmet bedeli oranı.",
        updatedAt: "2026-09-11T08:00:00Z",
      },
    ]);

    const html = await render();

    expect(settings.calls).toBe(1);
    expect(settings.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).toContain("commission.rate");
    expect(html).toContain("0.10");
    expect(html).toContain("0.075");
  });
});

describe("settings catalogue states", () => {
  it("still lists defined keys when GET returns no rows", async () => {
    stubMe(["settings.manage"], ["OWNER"]);
    watchSettings([]);

    const html = await render();

    expect(html).toContain("commission.rate");
    expect(html).toContain("assignment.auto-completion.grace-days");
    expect(html).not.toContain("Ayarlar yüklenemedi.");
  });

  it("keeps an API failure distinct and renders its requestId", async () => {
    stubMe(["settings.manage"], ["OWNER"]);
    watchSettings([], () =>
      HttpResponse.json(
        {
          success: false,
          message: "Ayar servisi geçici olarak kullanılamıyor.",
          httpStatus: "503 SERVICE_UNAVAILABLE",
          errorCode: "SERVICE_UNAVAILABLE",
          errorCategory: "INTERNAL_ERROR",
          requestId: "rid-settings-load",
          path: "/admin/settings",
          timeStamp: "2026-09-11T08:00:00.000000000Z",
        },
        { status: 503 },
      ),
    );

    const html = await render();

    expect(html).toContain("Ayarlar yüklenemedi.");
    expect(html).toContain("Ayar servisi geçici olarak kullanılamıyor.");
    expect(html).toContain("SERVICE_UNAVAILABLE");
    expect(html).toContain("rid-settings-load");
    expect(html).not.toContain("commission.rate");
  });
});
