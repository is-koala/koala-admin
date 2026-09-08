import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * `/staff` ekranı.
 *
 * İki farklı izin, iki farklı iddia:
 *
 *  - `staff.read` yoksa `GET /admin/staff` **hiç yapılmıyor** — istek sayısıyla
 *    ölçülüyor, markup'ın yokluğuyla değil.
 *  - `staff.manage` yoksa yazma formları çizilmiyor. Bu bir *kapı değil*, ve
 *    test de öyle yazıyor: asıl kapı `administration.test.ts`'te, ve orada da
 *    ölçü birimi istek sayısı.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: StaffPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const STAFF = apiUrl("/admin/staff");
const ROLES = apiUrl("/admin/roles");

const SELF_ID = adminMeSuccessBody.data.staffId;
const OTHER_ID = "b7f4a2c1-0000-4c00-8000-000000000077";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  backendSaysPasswordMustChange.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  backendSaysPasswordMustChange.mockReset();
});

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

const MEMBERS = [
  {
    id: SELF_ID,
    email: "trust-lead@koala.local",
    displayName: "Trust Lideri",
    active: true,
    mustChangePassword: false,
    lockedUntil: null,
    createdAt: "2026-09-01T08:00:00Z",
    roles: ["OWNER"],
  },
  {
    id: OTHER_ID,
    email: "yeni@koala.local",
    displayName: null,
    active: false,
    mustChangePassword: true,
    // Geçmişte bir kilit: hesap kilitli **değil**, yalnız bir zamanlar kilitliydi.
    lockedUntil: "2020-01-01T00:00:00Z",
    createdAt: "2026-09-07T08:00:00Z",
    roles: [],
  },
];

const ROLE_ROWS = [
  {
    id: "9a1c0f10-0003-4c00-8000-000000000002",
    code: "SUPPORT_AGENT",
    name: "Destek görevlisi",
    permissions: ["user.read"],
    includes: [],
  },
];

function watchStaff(): { readonly staff: number; readonly roles: number } {
  const seen = { staff: 0, roles: 0 };

  server.use(
    http.get(STAFF, () => {
      seen.staff += 1;
      return HttpResponse.json({
        success: true,
        message: "Personel listelendi.",
        httpStatus: "200 OK",
        path: "/admin/staff",
        requestId: "rid-staff",
        timeStamp: "2026-09-08T09:00:00.000000000Z",
        data: {
          content: MEMBERS,
          page: 0,
          size: 20,
          totalElements: MEMBERS.length,
          totalPages: 1,
          first: true,
          last: true,
        },
      });
    }),
    http.get(ROLES, () => {
      seen.roles += 1;
      return HttpResponse.json({
        success: true,
        message: "Personel rolleri listelendi.",
        httpStatus: "200 OK",
        path: "/admin/roles",
        requestId: "rid-roles",
        timeStamp: "2026-09-08T09:00:00.000000000Z",
        data: ROLE_ROWS,
      });
    }),
  );

  return seen;
}

const render = () => renderServerComponent(<StaffPage />);

describe("kapı: staff.read yoksa liste hiç istenmiyor", () => {
  it("staff.manage taşıyıp staff.read taşımayan biri için bile çekmiyor", async () => {
    // Bu ikisinin ayrı izinler olması bu ekranın bütün mimarisi: backend
    // `GET /admin/staff`'ı `staff.read`'e bağlamış. Yazma izni okuma açmaz.
    stubMe(["staff.manage", "role.manage"]);
    const calls = watchStaff();

    const html = await render();

    expect(calls.staff).toBe(0);
    expect(html).toContain("permission-denied");
    expect(html).toContain("Personel kayıtlarını görüntüle");
  });

  it("izinler çözülemediğinde de çekmiyor", async () => {
    server.use(http.get(ADMIN_ME, () => HttpResponse.error()));
    const calls = watchStaff();

    const html = await render();

    expect(calls.staff).toBe(0);
    expect(html).toContain("İzinleriniz çözülemedi");
  });

  it("staff.read varsa listeyi bir kez çekiyor", async () => {
    stubMe(["staff.read"]);
    const calls = watchStaff();

    await render();

    expect(calls.staff).toBe(1);
  });
});

describe("yalnız okuma: staff.manage yoksa yazma yüzeyi çizilmiyor", () => {
  it("rol listesini bile istemiyor, çünkü atama formu yok", async () => {
    // `GET /admin/roles` `role.manage` istiyor ve yalnız atama seçeneklerini
    // çizmek için okunuyor. Form yoksa istek de yok.
    stubMe(["staff.read"]);
    const calls = watchStaff();

    const html = await render();

    expect(calls.roles).toBe(0);
    expect(html).toContain("Yalnız okuma");
    expect(html).not.toContain("Personel oluştur</h2>");
  });

  it("gizlemenin bir savunma olmadığını yazıyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Bu bir gizleme değil bir yansıma");
  });

  it("staff.manage varsa oluşturma formunu ve MFA uyarısını çiziyor", async () => {
    stubMe(["staff.read", "staff.manage", "role.manage"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Personeli oluştur");
    expect(html).toContain("MFA yok — parola tek savunma");
    expect(html).toContain("ikinci bir kişi girdiği gün");
  });
});

describe("liste, olduğu gibi", () => {
  it("ad, e-posta, rolleri ve etkinlik durumunu gösteriyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("trust-lead@koala.local");
    expect(html).toContain("OWNER");
    expect(html).toContain("Etkin");
    expect(html).toContain("Devre dışı");
  });

  it("rolsüz bir hesabın hiçbir ekrana ulaşamayacağını söylüyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Rolsüz");
  });

  it("parola değiştirme bayrağını görünür kılıyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Parola değiştirmeli");
  });

  it("süresi dolmuş bir kilidi 'kilitli' diye göstermiyor", async () => {
    // `lockedUntil` dolu ama geçmişte: hesap giriş yapabilir. "Kilitli" rozeti
    // asmak, çalışan bir hesabı bozuk göstermek olurdu.
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).not.toContain("Kilitli —");
    expect(html).toContain("Süresi dolmuş");
  });

  it("listedeki rollerin yalnız doğrudan üyelikler olduğunu söylüyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Yalnız doğrudan üyelikler");
  });
});

describe("kendini kilitleme, ekranda", () => {
  it("kendi kaydını işaretliyor ve kendini devre dışı bırakamayacağını söylüyor", async () => {
    stubMe(["staff.read", "staff.manage", "role.manage"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Bu sizsiniz");
    expect(html).toContain("STAFF_MEMBERSHIP_SELF_LOCKOUT");
  });

  it("rol geri alma düğmesinin yanında son yönetici kuralını yazıyor", async () => {
    stubMe(["staff.read", "staff.manage", "role.manage"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("sistemdeki son yöneticiyi bırakamazsınız");
  });
});

describe("rol listesi okunamadığında", () => {
  it("personel listesini götürmüyor, atama formunu çizmiyor ve sebebini yazıyor", async () => {
    // `staff.manage` taşıyıp `role.manage` taşımayan biri için beklenen durum.
    stubMe(["staff.read", "staff.manage"]);
    server.use(
      http.get(STAFF, () =>
        HttpResponse.json({
          success: true,
          message: "Personel listelendi.",
          httpStatus: "200 OK",
          path: "/admin/staff",
          requestId: "rid-staff",
          timeStamp: "2026-09-08T09:00:00.000000000Z",
          data: {
            content: MEMBERS,
            page: 0,
            size: 20,
            totalElements: MEMBERS.length,
            totalPages: 1,
            first: true,
            last: true,
          },
        }),
      ),
      http.get(ROLES, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu işlem için gereken personel iznine sahip değilsiniz.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-403",
            path: "/admin/roles",
            timeStamp: "2026-09-08T09:00:00.000000000Z",
          },
          { status: 403 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("trust-lead@koala.local");
    expect(html).toContain("Rol listesi okunamadı");
    // Parola atama ve devre dışı bırakma formları hâlâ çizilmeli: onlar rol
    // listesine bağlı değil.
    expect(html).toContain("Parolayı ata");
  });
});

describe("denetim kaydı ve eksikler", () => {
  it("değişikliklerin kayda gittiğini ve nasıl aranacağını yazıyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("permission=staff.manage");
  });

  it("ad ve e-postanın sonradan değiştirilemediğini söylüyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Ad ve e-posta sonradan değiştirilemiyor");
  });

  it("parolanın kişiye panel dışından iletilmesi gerektiğini söylüyor", async () => {
    stubMe(["staff.read"]);
    watchStaff();

    const html = await render();

    expect(html).toContain("Atanan parolayı kişiye panel iletmiyor");
  });

  it("liste okunamadığında sebebi ve eksikleri gösteriyor", async () => {
    stubMe(["staff.read"]);
    server.use(
      http.get(STAFF, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/staff",
            timeStamp: "2026-09-08T09:00:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("rid-500");
    expect(html).toContain("Personel kaydı silinemiyor");
  });
});
