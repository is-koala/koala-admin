import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * `/roles` ekranı — ve ekranın *çizilmesinin* kanıt sayılmaması.
 *
 * En önemli iddia yine markup değil: `roles.calls === 0`. `<RoleGraph>` gate'e
 * bir element olarak veriliyor, yani izin yoksa bileşen fonksiyonu hiç
 * çalışmıyor, token okunmuyor ve `GET /admin/roles` sunucudan hiç çıkmıyor.
 * Yalnız HTML'in yokluğuna bakan bir test, veriyi çekip gizleyen bir sayfayı da
 * geçirirdi.
 *
 * İkinci iddia görev ayrılığı hakkında ve tersine: kural **uygulanmadığı** için
 * ekranın onu uygulandığı izlenimi vermemesi gerekiyor. Bunu ölçen testler
 * "backend kabul eder" cümlesinin gerçekten yazıldığını arıyor.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: RolesPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const ROLES = apiUrl("/admin/roles");
const PERMISSIONS = apiUrl("/admin/permissions");

const TRUST_LEAD_ID = "9a1c0f10-0003-4c00-8000-000000000008";
const FINANCE_OFFICER_ID = "9a1c0f10-0003-4c00-8000-000000000009";
const SUPPORT_AGENT_ID = "9a1c0f10-0003-4c00-8000-000000000002";
const MODERATOR_ID = "9a1c0f10-0003-4c00-8000-000000000005";
const OWNER_ID = "9a1c0f10-0003-4c00-8000-000000000010";

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["OWNER"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function envelope(path: string, data: unknown) {
  return {
    success: true,
    message: "Liste getirildi.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-roles",
    timeStamp: "2026-09-08T09:00:00.000000000Z",
    data,
  };
}

/** Seed'lenmiş grafiğin bir dilimi — ADR-0014 §Rol grafiği'nin kenarlarıyla. */
const ROLE_ROWS = [
  {
    id: SUPPORT_AGENT_ID,
    code: "SUPPORT_AGENT",
    name: "Destek görevlisi",
    permissions: ["user.read"],
    includes: [],
  },
  {
    id: MODERATOR_ID,
    code: "MODERATOR",
    name: "Moderatör",
    permissions: ["content.moderate"],
    includes: [{ id: SUPPORT_AGENT_ID, code: "SUPPORT_AGENT", name: "Destek görevlisi" }],
  },
  {
    id: TRUST_LEAD_ID,
    code: "TRUST_LEAD",
    name: "Güven ekibi lideri",
    permissions: ["user.read_pii"],
    includes: [{ id: MODERATOR_ID, code: "MODERATOR", name: "Moderatör" }],
  },
  {
    id: FINANCE_OFFICER_ID,
    code: "FINANCE_OFFICER",
    name: "Finans yetkilisi",
    permissions: ["payout.release", "payment.refund"],
    includes: [],
  },
  {
    id: OWNER_ID,
    code: "OWNER",
    name: "Sahip",
    permissions: ["role.manage", "staff.manage", "staff.read"],
    includes: [
      { id: TRUST_LEAD_ID, code: "TRUST_LEAD", name: "Güven ekibi lideri" },
      { id: FINANCE_OFFICER_ID, code: "FINANCE_OFFICER", name: "Finans yetkilisi" },
    ],
  },
];

const PERMISSION_ROWS = [
  { code: "category.manage", mutating: true, sensitivity: "NORMAL" },
  { code: "payout.release", mutating: true, sensitivity: "FINANCIAL" },
  { code: "staff.read", mutating: false, sensitivity: "PERSONAL_DATA" },
];

function watchGraph(): { readonly roles: number; readonly permissions: number } {
  const seen = { roles: 0, permissions: 0 };

  server.use(
    http.get(ROLES, () => {
      seen.roles += 1;
      return HttpResponse.json(envelope("/admin/roles", ROLE_ROWS));
    }),
    http.get(PERMISSIONS, () => {
      seen.permissions += 1;
      return HttpResponse.json(envelope("/admin/permissions", PERMISSION_ROWS));
    }),
  );

  return seen;
}

const render = () => renderServerComponent(<RolesPage />);

describe("kapı: izin yoksa hiçbir şey çekilmiyor", () => {
  it("role.manage taşımayan biri için GET /admin/roles'u hiç çağırmıyor", async () => {
    // `expected 1 to be +0` deseninin bu ekrandaki karşılığı. Markup'ın
    // yokluğu yetmez: veriyi çekip gizleyen bir sayfa da aynı HTML'i verirdi.
    stubMe(["staff.manage", "audit.read"], ["SUPPORT_AGENT"]);
    const graph = watchGraph();

    const html = await render();

    expect(graph.roles).toBe(0);
    expect(graph.permissions).toBe(0);
    expect(html).toContain("permission-denied");
    expect(html).toContain("Rol grafiğini yönet");
  });

  it("izinler çözülemediğinde de çağırmıyor", async () => {
    server.use(http.get(ADMIN_ME, () => HttpResponse.error()));
    const graph = watchGraph();

    const html = await render();

    expect(graph.roles).toBe(0);
    expect(html).toContain("İzinleriniz çözülemedi");
  });

  it("role.manage varsa grafiği bir kez çekiyor", async () => {
    stubMe(["role.manage"]);
    const graph = watchGraph();

    await render();

    expect(graph.roles).toBe(1);
    expect(graph.permissions).toBe(1);
  });
});

describe("DAG ekranda", () => {
  it("her rolü, doğrudan izinlerini ve kapsadıklarını yazıyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("TRUST_LEAD");
    expect(html).toContain("Güven ekibi lideri");
    expect(html).toContain("user.read_pii");
  });

  it("etkili izinleri kalıtımla gelenleri işaretleyerek gösteriyor", async () => {
    // TRUST_LEAD → MODERATOR → SUPPORT_AGENT. Doğrudan izni user.read_pii;
    // content.moderate ve user.read kalıtımla geliyor. Bu ayrım olmadan bir
    // izni kaldırıp kalıtımla geri geldiğini görmemek çok kolay.
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("(kalıtım)");
    expect(html).toContain("(doğrudan)");
    // Kapanış bir küme: sıralı ve rolün kendisini de içeriyor.
    expect(html).toContain("MODERATOR, SUPPORT_AGENT, TRUST_LEAD");
  });

  it("etkili izin önizlemesini backend'in verdiği kenarlardan kuruyor", async () => {
    // OWNER hem TRUST_LEAD'i hem FINANCE_OFFICER'ı kapsıyor, yani finansal
    // izinlere de ulaşıyor. "Bu rol sonuçta hangi izinlere sahip" sorusunun
    // cevabı bu.
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("FINANCE_OFFICER, MODERATOR, OWNER, SUPPORT_AGENT, TRUST_LEAD");
    expect(html).toContain("payout.release");
  });

  it("türetilen etkili izinler backend'in effectivePermissions cevabıyla birebir aynı", async () => {
    /**
     * Panel `GET /admin/roles/{roleId}`'yi çağırmıyor: liste cevabı grafiğin
     * tamamını verdiği için birleşim panelde kuruluyor. Bu testin işi o
     * kestirmenin **doğru** olduğunu sabitlemek.
     *
     * `EXPECTED` aşağıda elle değil, `StaffAuthorizationManager.graph()`'in
     * tanımına göre yazıldı: rolün doğrudan izinleri ∪ ulaştığı her rolün
     * doğrudan izinleri. Backend o tanımı değiştirirse bu test kırmızıya döner
     * ve doğru cevap detay ucunu çağırmaya dönmek olur.
     */
    const EXPECTED: Record<string, string[]> = {
      SUPPORT_AGENT: ["user.read"],
      MODERATOR: ["content.moderate", "user.read"],
      TRUST_LEAD: ["content.moderate", "user.read", "user.read_pii"],
      FINANCE_OFFICER: ["payment.refund", "payout.release"],
      OWNER: [
        "content.moderate",
        "payment.refund",
        "payout.release",
        "role.manage",
        "staff.manage",
        "staff.read",
        "user.read",
        "user.read_pii",
      ],
    };

    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    for (const [code, permissions] of Object.entries(EXPECTED)) {
      // Rolün kendi `<details>` bloğunun "Etkili izinler" bölümü. Her izin bir
      // rozet ve her rozet "(doğrudan)" ya da "(kalıtım)" ile bitiyor, yani
      // rozetleri saymak listenin uzunluğunu ölçüyor: fazladan bir izin de
      // eksik bir izin de bu sayıyı kaydırır.
      const block = html.split(`id="rol-${code}"`)[1]?.split("</details>")[0] ?? "";
      const effective = block.split("Etkili izinler")[1] ?? "";
      const badges = (effective.match(/\((?:doğrudan|kalıtım)\)/g) ?? []).length;

      expect(badges, `${code} etkili izin sayısı`).toBe(permissions.length);

      for (const permission of permissions) {
        expect(effective, `${code} → ${permission}`).toContain(`>${permission}</span>`);
      }
    }
  });
});

describe("döngü: reddedileceği belli olan seçenek kapalı", () => {
  it("SUPPORT_AGENT'ın TRUST_LEAD'i kapsamasını seçilemez yapıyor ve sebebini yazıyor", async () => {
    // Backend bunu 409 ile reddediyor. Panel reddi üretmiyor, yalnız önceden
    // görünür kılıyor.
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("döngü yaratır, backend 409 döner");
  });
});

describe("görev ayrılığı: gösteriliyor, uygulanmıyor", () => {
  it("kuralın çalışma anında uygulanmadığını sayfanın en üstünde söylüyor", async () => {
    // Kabul maddesi "reddediliyor ve sebebi ekranda yazıyor" diyor;
    // reddedilmiyor. Ekranın bunu saklaması, kuralın var olduğu yanılgısını
    // sürdürmek olurdu.
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("Görev ayrılığı kuralı burada gösterilir, uygulanmaz.");
    expect(html).toContain("StaffRoleGraphSeedTest");
  });

  it("iki dalı birleştirecek bir kapsamayı seçilebilir bırakıyor ama uyarısını yazıyor", async () => {
    // Seçenek **kapalı değil**: backend onu kabul ediyor ve panelin kapatması
    // olmayan bir kapıyı varmış gibi göstermek olurdu.
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("Backend bu yazımı yine de KABUL EDER");
    // Ve seçenek gerçekten seçilebilir: sebebi olan seçenekler etiketlerine
    // "— sebep" ekliyor, bu yüzden ihlal seçeneğinin öyle bir eki olmamalı.
    expect(html).not.toContain("FINANCE_OFFICER — Finans yetkilisi — ");
  });

  it("OWNER'ı istisna, TRUST_LEAD'i tek dal olarak işaretliyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("İki dal — yazılı istisna");
    expect(html).not.toContain("İki dal — kural ihlali");
  });

  it("iki dalı gerçekten birleştiren bir rolü ihlal olarak gösteriyor", async () => {
    stubMe(["role.manage"]);
    server.use(
      http.get(ROLES, () =>
        HttpResponse.json(
          envelope("/admin/roles", [
            ...ROLE_ROWS,
            {
              id: "9a1c0f10-0003-4c00-8000-000000000099",
              code: "HER_SEYCI",
              name: "Her şeyci",
              permissions: [],
              includes: [
                { id: TRUST_LEAD_ID, code: "TRUST_LEAD", name: "Güven ekibi lideri" },
                { id: FINANCE_OFFICER_ID, code: "FINANCE_OFFICER", name: "Finans yetkilisi" },
              ],
            },
          ]),
        ),
      ),
      http.get(PERMISSIONS, () =>
        HttpResponse.json(envelope("/admin/permissions", PERMISSION_ROWS)),
      ),
    );

    const html = await render();

    expect(html).toContain("İki dal — kural ihlali");
    expect(html).toContain("Backend bu durumu reddetmez");
  });
});

describe("denetim kaydı ve eksikler", () => {
  it("değişikliklerin denetim kaydına gittiğini ve nasıl aranacağını yazıyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain("permission=role.manage");
  });

  it("rol yaratma ucunun olmadığını söylüyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("Rol yaratma, adlandırma ve silme ucu yok");
  });

  it("grafik okunamadığında eksikleri yine de gösteriyor ve sebebi söylüyor", async () => {
    stubMe(["role.manage"]);
    server.use(
      http.get(ROLES, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/roles",
            timeStamp: "2026-09-08T09:00:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
      http.get(PERMISSIONS, () =>
        HttpResponse.json(envelope("/admin/permissions", PERMISSION_ROWS)),
      ),
    );

    const html = await render();

    expect(html).toContain("rid-500");
    expect(html).toContain("Görev ayrılığı kuralı çalışma anında uygulanmıyor");
  });
});
