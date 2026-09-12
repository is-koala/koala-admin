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
 * İkinci iddia görev ayrılığı hakkında: backend kuralı artık çalışma anında
 * uyguluyor. Panel geçersiz bir yazımı hazırlatmamalı, doğrudan Server Action
 * çağrılırsa da backend'in reddi nihai karar olarak görünmeli.
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
const STAFF = apiUrl("/admin/staff");

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

function staffPage(content: readonly unknown[]) {
  return envelope("/admin/staff", {
    content,
    page: 0,
    size: 100,
    totalElements: content.length,
    totalPages: content.length === 0 ? 0 : 1,
    first: true,
    last: true,
  });
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

/**
 * `GET /admin/roles/{roleId}` — panelin **çağırmadığı** uç.
 *
 * `StaffRoleDetailDto`'nun liste DTO'suna eklediği iki alan burada:
 * `effectiveRoles` (kapanış, rolün kendisi **hariç**) ve `effectivePermissions`
 * (doğrudan olanlar ∪ ulaşılan her rolün doğrudan olanları). Panel bu ucu
 * çağırmıyor — on rol on istek demekti — ve aşağıdaki test, türettiği şeyin
 * tam olarak bu cevap olduğunu ölçüyor.
 *
 * Yani karşılaştırılan şey artık testin içinde elle yazılmış bir tablo değil,
 * DTO'nun kendi biçimindeki bir cevap. Fixture yine bir kopya — sözleşmenin
 * kopyası — ama panelin türetmesiyle **aynı yerden** gelmiyor: biri grafiği
 * geziyor, öteki cevabın alanını okuyor.
 */
const ROLE_DETAILS: Record<string, { effectiveRoles: string[]; effectivePermissions: string[] }> = {
  [SUPPORT_AGENT_ID]: { effectiveRoles: [], effectivePermissions: ["user.read"] },
  [MODERATOR_ID]: {
    effectiveRoles: ["SUPPORT_AGENT"],
    effectivePermissions: ["content.moderate", "user.read"],
  },
  [TRUST_LEAD_ID]: {
    effectiveRoles: ["MODERATOR", "SUPPORT_AGENT"],
    effectivePermissions: ["user.read_pii", "content.moderate", "user.read"],
  },
  [FINANCE_OFFICER_ID]: {
    effectiveRoles: [],
    effectivePermissions: ["payout.release", "payment.refund"],
  },
  [OWNER_ID]: {
    effectiveRoles: ["TRUST_LEAD", "FINANCE_OFFICER", "MODERATOR", "SUPPORT_AGENT"],
    effectivePermissions: [
      "role.manage",
      "staff.manage",
      "staff.read",
      "user.read_pii",
      "content.moderate",
      "user.read",
      "payout.release",
      "payment.refund",
    ],
  },
};

function watchGraph(): {
  readonly roles: number;
  readonly permissions: number;
  readonly details: number;
  readonly staff: number;
} {
  const seen = { roles: 0, permissions: 0, details: 0, staff: 0 };

  server.use(
    http.get(ROLES, () => {
      seen.roles += 1;
      return HttpResponse.json(envelope("/admin/roles", ROLE_ROWS));
    }),
    http.get(PERMISSIONS, () => {
      seen.permissions += 1;
      return HttpResponse.json(envelope("/admin/permissions", PERMISSION_ROWS));
    }),
    http.get(STAFF, () => {
      seen.staff += 1;
      return HttpResponse.json(staffPage([]));
    }),
    http.get(`${ROLES}/:roleId`, ({ params }) => {
      seen.details += 1;
      const roleId = String(params.roleId);
      const row = ROLE_ROWS.find((entry) => entry.id === roleId);
      const detail = ROLE_DETAILS[roleId];

      if (row === undefined || detail === undefined) {
        return new HttpResponse(null, { status: 404 });
      }

      return HttpResponse.json(envelope(`/admin/roles/${roleId}`, { ...row, ...detail }));
    }),
  );

  return seen;
}

/** Backend'in detay cevabı, testin kendi ağzından sorulmuş hâliyle. */
async function backendDetail(
  roleId: string,
): Promise<{ effectiveRoles: string[]; effectivePermissions: string[] }> {
  const response = await fetch(apiUrl(`/admin/roles/${roleId}`));
  const body = (await response.json()) as {
    data: { effectiveRoles: string[]; effectivePermissions: string[] };
  };

  return body.data;
}

/** Bir rolün `<details>` bloğu — ekranın o role ait bütün söyledikleri. */
function detailBlock(html: string, code: string): string {
  return html.split(`id="rol-${code}"`)[1]?.split("</details>")[0] ?? "";
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
     * kestirmenin **doğru** olduğunu ölçmek — ve neye karşı ölçtüğü belli
     * olsun diye detay ucu gerçekten kuruluyor: `ROLE_DETAILS` `StaffRoleDetail
     * Dto`'nun iki alanını taşıyor, test onları ucun kendisinden okuyor ve
     * ekranda çıkanla karşılaştırıyor.
     *
     * İki iddia birden: panel o ucu çağırmıyor (istek sayısı), ve çağırmadan
     * ürettiği şey onun cevabıyla aynı.
     */
    stubMe(["role.manage"]);
    const graph = watchGraph();

    const html = await render();

    // Kestirmenin sebebi: on rol için on istek. Çizim sırasında detay ucuna
    // tek bir çağrı bile gitmemeli.
    expect(graph.details).toBe(0);

    for (const row of ROLE_ROWS) {
      const detail = await backendDetail(row.id);
      const block = detailBlock(html, row.code);

      // Rolün kendi `<details>` bloğunun "Etkili izinler" bölümü. Her izin bir
      // rozet ve her rozet "(doğrudan)" ya da "(kalıtım)" ile bitiyor, yani
      // rozetleri saymak listenin uzunluğunu ölçüyor: fazladan bir izin de
      // eksik bir izin de bu sayıyı kaydırır.
      const effective = block.split("Etkili izinler")[1] ?? "";
      const badges = (effective.match(/\((?:doğrudan|kalıtım)\)/g) ?? []).length;

      expect(badges, `${row.code} etkili izin sayısı`).toBe(detail.effectivePermissions.length);

      for (const permission of detail.effectivePermissions) {
        expect(effective, `${row.code} → ${permission}`).toContain(`>${permission}</span>`);
      }

      /**
       * Kapanış da aynı cevaptan ölçülüyor. Tek fark tanımda: backend'in
       * `effectiveRoles`'ü rolün kendisini **dışarıda** bırakıyor, panelin
       * gösterdiği küme onu içeriyor (`closureWithSelf`) — çünkü "bu rol hangi
       * dalları kapsıyor" sorusu kendisini de sayar.
       */
      const closure = [...detail.effectiveRoles, row.code].sort((a, b) => a.localeCompare(b, "tr"));

      expect(block, `${row.code} kapanışı`).toContain(closure.join(", "));
    }
  });
});

describe("döngü: reddedileceği belli olan seçenek kapalı, ötekiler açık", () => {
  /** Bir rolün kapsama `<select>`'indeki tek bir seçeneğin `<option>` etiketi. */
  function optionFor(html: string, parent: string, child: string): string {
    const block = detailBlock(html, parent);
    return block.match(new RegExp(`<option value="[^"]*:${child}"[^>]*>`))?.[0] ?? "";
  }

  it("SUPPORT_AGENT'ın TRUST_LEAD'i kapsamasını seçilemez yapıyor ve sebebini yazıyor", async () => {
    // Backend bunu 409 ile reddediyor. Panel reddi üretmiyor, yalnız önceden
    // görünür kılıyor.
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("döngü yaratır, backend 409 döner");
    expect(optionFor(html, "SUPPORT_AGENT", "TRUST_LEAD")).toContain("disabled");
  });

  it("zaten ulaşılan bir rolü kapsama seçeneğini kapatmıyor", async () => {
    /**
     * Kuralın öteki yönü, ve ölçülmeyen yönü buydu: `wouldCycle`'a
     * `|| closureWithSelf(graph, parent).includes(child)` eklemek gerçek
     * döngüleri koruyup **meşru** seçenekleri kapatıyor, ve 516 testin hepsi
     * yeşil kalıyordu.
     *
     * OWNER, SUPPORT_AGENT'a TRUST_LEAD → MODERATOR üzerinden zaten ulaşıyor.
     * Doğrudan kenarı yazmak bir döngü değil; backend onu kabul ediyor. Panelin
     * seçeneği kapatması, açık bir kapıyı sessizce kapatmak olurdu — operatör
     * kapalı bir seçeneğin neden kapalı olduğunu sorgulamaz.
     */
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    const option = optionFor(html, "OWNER", "SUPPORT_AGENT");

    expect(option).not.toBe("");
    expect(option).not.toContain("disabled");
    expect(detailBlock(html, "OWNER")).not.toContain(
      "SUPPORT_AGENT — Destek görevlisi — döngü yaratır",
    );
  });
});

describe("görev ayrılığı: backend kuralının arayüzdeki ön izlemesi", () => {
  it("kuralın backend tarafından uygulandığını sayfanın en üstünde söylüyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).toContain("Görev ayrılığı backend tarafından uygulanır.");
    expect(html).toContain("Panel, reddedileceği belli birleşimleri önceden seçilemez yapar");
    expect(html).not.toContain("backend kabul eder");
    expect(html).not.toContain("Backend bu yazımı yine de KABUL EDER");
  });

  it("iki dalı birleştirecek kapsamayı sebebiyle seçilemez yapıyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();
    const block = detailBlock(html, "TRUST_LEAD");
    const option =
      block.match(new RegExp(`<option value="[^"]*:FINANCE_OFFICER"[^>]*>[^<]*</option>`))?.[0] ??
      "";

    expect(option).toContain("disabled");
    expect(option).toContain("görev ayrılığını bozar; backend 409 döner");
  });

  it("üst rolü iki dala taşıyacak kapsamayı da seçilemez yapıyor", async () => {
    /**
     * SUPPORT_AGENT tek başına FINANCE_OFFICER'ı kapsarsa yalnız finans dalına
     * geçer. Fakat TRUST_LEAD ona MODERATOR üzerinden ulaşıyor; aynı kenar
     * TRUST_LEAD'i iki dala taşır ve backend etkilenen üst rolleri de denetler.
     */
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();
    const block = detailBlock(html, "SUPPORT_AGENT");
    const option =
      block.match(new RegExp(`<option value="[^"]*:FINANCE_OFFICER"[^>]*>[^<]*</option>`))?.[0] ??
      "";

    expect(option).toContain("disabled");
    expect(option).toContain("görev ayrılığını bozar; backend 409 döner");
  });

  it("rol tek dalda kalsa bile mevcut personeli iki dala taşıyacak kapsamayı seçilemez yapıyor", async () => {
    const catalogEditor = {
      id: "9a1c0f10-0003-4c00-8000-000000000001",
      code: "CATALOG_EDITOR",
      name: "Katalog editörü",
      permissions: [],
      includes: [],
    };
    stubMe(["role.manage", "staff.read"]);
    watchGraph();
    server.use(
      http.get(ROLES, () =>
        HttpResponse.json(envelope("/admin/roles", [...ROLE_ROWS, catalogEditor])),
      ),
      http.get(STAFF, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page") ?? 0);
        const affectedMember = {
          id: "b7f4a2c1-0000-4c00-8000-000000000079",
          email: "finans-katalog@koala.local",
          displayName: "Finans ve katalog görevlisi",
          active: true,
          mustChangePassword: false,
          lockedUntil: null,
          createdAt: "2026-09-12T10:00:00Z",
          roles: ["FINANCE_OFFICER", "CATALOG_EDITOR"],
        };

        return HttpResponse.json(
          envelope("/admin/staff", {
            content: page === 1 ? [affectedMember] : [],
            page,
            size: 100,
            totalElements: 1,
            totalPages: 2,
            first: page === 0,
            last: page === 1,
          }),
        );
      }),
    );

    const html = await render();
    const block = detailBlock(html, "CATALOG_EDITOR");
    const option =
      block.match(new RegExp(`<option value="[^"]*:MODERATOR"[^>]*>[^<]*</option>`))?.[0] ?? "";

    expect(option).toContain("disabled");
    expect(option).toContain("görev ayrılığını bozar; backend 409 döner");
  });

  it("aynı dalda kalan kapsamayı seçilebilir bırakıyor", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();
    const block = detailBlock(html, "TRUST_LEAD");
    const option =
      block.match(new RegExp(`<option value="[^"]*:SUPPORT_AGENT"[^>]*>[^<]*</option>`))?.[0] ?? "";

    expect(option).not.toBe("");
    expect(option).not.toContain("disabled");
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
    expect(html).toContain("Backend yeni rol grafiği yazımlarında bu birleşimi 409 ile reddeder");
    expect(html).not.toContain("Backend bu durumu reddetmez");
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

  it("does not list backend gaps as unfinished work", async () => {
    stubMe(["role.manage"]);
    watchGraph();

    const html = await render();

    expect(html).not.toContain("Rol yaratma, adlandırma ve silme ucu yok");
    expect(html).not.toContain("Backend&#x27;in veremedikleri");
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
    expect(html).not.toContain("Görev ayrılığı kuralı çalışma anında uygulanmıyor");
  });
});
