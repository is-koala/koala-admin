import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { asRoleCode, asRoleId } from "@/lib/role-identity";

import { apiUrl, server } from "../../../test/msw";

/**
 * Kapının gerçekten kapandığı — ekranın çizildiği değil.
 *
 * Bu dosyanın ölçü birimi **istek sayısı**. "İzin yoksa yapılmaz" bir markup
 * iddiası değil bir davranış iddiasıdır, ve yalnız şu iki satır onu kanıtlar:
 *
 * ```ts
 * expect(grant.calls).toBe(0);
 * expect(state.status).toBe("BLOCKED");
 * ```
 *
 * İlki olmadan ikincisi hiçbir şey söylemez: izinsiz çağrıyı backend'e
 * gönderip cevabını gizleyen bir panel de aynı ekranı çizerdi.
 *
 * ## Burada kanıtlanmayan şey
 *
 * Kuralların hiçbiri. Döngü, görev ayrılığı, "sahip olmadığın izni veremezsin"
 * ve kendini kilitleme koruması **backend'in**; panelde onların bir kopyası
 * yok ve olmaması bilinçli. Bu dosyanın onlar hakkında kanıtladığı tek şey,
 * gelen reddin operatörün okuyabileceği bir cümleye dönüştüğü.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { runAuthorizationChange } = await import("./administration");

const ADMIN_ME = apiUrl("/admin/me");
/**
 * Kimlik ve kod tip düzeyinde ayrı (`src/lib/role-identity.ts`); testin de
 * hangisini nereye koyduğunu söylemesi gerekiyor. Bu iki dizeyi yer
 * değiştirmek artık derlenmiyor — eskiden hem `tsc`'den hem bu dosyanın
 * tamamından geçiyordu.
 */
const ROLE_ID = asRoleId("9a1c0f10-0003-4c00-8000-000000000008");
const CHILD_ROLE_ID = asRoleId("9a1c0f10-0003-4c00-8000-000000000009");
const TRUST_LEAD = asRoleCode("TRUST_LEAD");
const FINANCE_OFFICER = asRoleCode("FINANCE_OFFICER");
const SUPPORT_AGENT = asRoleCode("SUPPORT_AGENT");
const OWNER = asRoleCode("OWNER");
const STAFF_ID = "b7f4a2c1-0000-4c00-8000-000000000002";

const GRANT_PERMISSION = apiUrl(`/admin/roles/${ROLE_ID}/permissions`);
const REVOKE_PERMISSION = apiUrl(`/admin/roles/${ROLE_ID}/permissions/:permission`);
const ADD_INCLUDE = apiUrl(`/admin/roles/${ROLE_ID}/includes`);
const REMOVE_INCLUDE = apiUrl(`/admin/roles/${ROLE_ID}/includes/${CHILD_ROLE_ID}`);
const CREATE_STAFF = apiUrl("/admin/staff");
const PATCH_STAFF = apiUrl(`/admin/staff/${STAFF_ID}`);
const STAFF_ROLE = apiUrl(`/admin/staff/${STAFF_ID}/roles/:roleCode`);
const STAFF_PASSWORD = apiUrl(`/admin/staff/${STAFF_ID}/password`);
const MARKETPLACE_USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_ROLES = apiUrl(`/admin/users/${MARKETPLACE_USER_ID}/roles`);
const USER_ROLE = apiUrl(`/admin/users/${MARKETPLACE_USER_ID}/roles/:role`);

const GOOD_PASSWORD = "kedi-koala-2026!";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
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

/** Bir uca giden her çağrıyı sayar — kapının ne karar verdiğinden bağımsız. */
function watch(
  method: "post" | "delete" | "patch",
  url: string,
  respond?: () => Response,
): { readonly calls: number; readonly body: string | null } {
  const seen = { calls: 0, body: null as string | null };

  server.use(
    http[method](url, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.text();
      return respond === undefined ? ok() : respond();
    }),
  );

  return seen;
}

/** `SuccessResult` — dört rol ucunun ve üç personel ucunun cevabı: `data` yok. */
function ok(): Response {
  return HttpResponse.json({
    success: true,
    message: "İzin role verildi.",
    httpStatus: "200 OK",
    path: "/admin/roles",
    requestId: "rid-ok",
    timeStamp: "2026-09-08T09:00:00.000000000Z",
  });
}

function refusal(status: number, errorCode: string, message: string, extra = {}): Response {
  return HttpResponse.json(
    {
      success: false,
      message,
      httpStatus: `${status} ${status === 403 ? "FORBIDDEN" : "CONFLICT"}`,
      errorCode,
      errorCategory: status === 403 ? "ACCESS_DENIED" : "DATA_CONFLICT",
      requestId: `rid-${errorCode}`,
      path: "/admin/roles",
      timeStamp: "2026-09-08T09:00:00.000000000Z",
      ...extra,
    },
    { status },
  );
}

const GRANT_CATEGORY = {
  kind: "ROLE_PERMISSION_GRANT",
  roleId: ROLE_ID,
  roleCode: TRUST_LEAD,
  permission: "category.manage",
} as const;

const REVOKE_CATEGORY = {
  kind: "ROLE_PERMISSION_REVOKE",
  roleId: ROLE_ID,
  roleCode: TRUST_LEAD,
  permission: "category.manage",
} as const;

const CREATE = {
  kind: "STAFF_CREATE",
  email: "yeni@koala.local",
  displayName: "Yeni Personel",
  password: GOOD_PASSWORD,
} as const;

describe("izin yoksa istek hiç yapılmıyor", () => {
  it("role.manage taşımayan biri için rol iznini göndermiyor", async () => {
    // `staff.manage` `role.manage` değil. Formu çizen sayfa bir savunma değil;
    // bu eylemin kendi URL'i var.
    stubMe(["staff.manage", "audit.read"]);
    const grant = watch("post", GRANT_PERMISSION);

    const outcome = await runAuthorizationChange(GRANT_CATEGORY);

    expect(grant.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("PANEL_PERMISSION_DENIED");
    expect(outcome.message).toContain("Rol grafiğini yönet");
  });

  it("her dört rol yazımını da aynı şekilde durduruyor", async () => {
    stubMe(["staff.manage"]);
    const calls = [
      watch("post", GRANT_PERMISSION),
      watch("delete", REVOKE_PERMISSION),
      watch("post", ADD_INCLUDE),
      watch("delete", REMOVE_INCLUDE),
    ];

    const outcomes = await Promise.all([
      runAuthorizationChange(GRANT_CATEGORY),
      runAuthorizationChange(REVOKE_CATEGORY),
      runAuthorizationChange({
        kind: "ROLE_INCLUDE_ADD",
        roleId: ROLE_ID,
        roleCode: TRUST_LEAD,
        includedRoleId: CHILD_ROLE_ID,
        includedRoleCode: FINANCE_OFFICER,
      }),
      runAuthorizationChange({
        kind: "ROLE_INCLUDE_REMOVE",
        roleId: ROLE_ID,
        roleCode: TRUST_LEAD,
        includedRoleId: CHILD_ROLE_ID,
        includedRoleCode: FINANCE_OFFICER,
      }),
    ]);

    expect(calls.map((call) => call.calls)).toEqual([0, 0, 0, 0]);
    expect(outcomes.map((outcome) => outcome.status)).toEqual([
      "BLOCKED",
      "BLOCKED",
      "BLOCKED",
      "BLOCKED",
    ]);
  });

  it("staff.read taşıyan ama staff.manage taşımayan biri personel oluşturamıyor", async () => {
    // `/staff` sayfasının kapısı `staff.read`. Sayfayı görmek, yazma uçlarını
    // çağırabilmek anlamına gelmemeli ve bunu ölçen yer burası.
    stubMe(["staff.read"]);
    const create = watch("post", CREATE_STAFF);

    const outcome = await runAuthorizationChange(CREATE);

    expect(create.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("Personel kayıtlarını yönet");
  });

  it("her beş personel yazımını da durduruyor", async () => {
    stubMe(["staff.read", "role.manage"]);
    const calls = [
      watch("post", CREATE_STAFF),
      watch("patch", PATCH_STAFF),
      watch("post", STAFF_ROLE),
      watch("delete", STAFF_ROLE),
      watch("post", STAFF_PASSWORD),
    ];

    const outcomes = await Promise.all([
      runAuthorizationChange(CREATE),
      runAuthorizationChange({
        kind: "STAFF_SET_ACTIVE",
        staffId: STAFF_ID,
        staffLabel: "Bir Personel",
        active: false,
      }),
      runAuthorizationChange({
        kind: "STAFF_ROLE_GRANT",
        staffId: STAFF_ID,
        staffLabel: "Bir Personel",
        roleCode: OWNER,
      }),
      runAuthorizationChange({
        kind: "STAFF_ROLE_REVOKE",
        staffId: STAFF_ID,
        staffLabel: "Bir Personel",
        roleCode: OWNER,
      }),
      runAuthorizationChange({
        kind: "STAFF_PASSWORD_RESET",
        staffId: STAFF_ID,
        staffLabel: "Bir Personel",
        password: GOOD_PASSWORD,
      }),
    ]);

    expect(calls.map((call) => call.calls)).toEqual([0, 0, 0, 0, 0]);
    expect(new Set(outcomes.map((outcome) => outcome.status))).toEqual(new Set(["BLOCKED"]));
  });

  it("izinler çözülemediğinde de göndermiyor — fail-closed", async () => {
    // Ulaşılamayan bir backend, boş bir izin listesi demek. Boş liste hiçbir
    // yazımı geçirmez; "emin değilsem yapmam" davranışı bu.
    server.use(http.get(ADMIN_ME, () => HttpResponse.error()));
    const grant = watch("post", GRANT_PERMISSION);

    const outcome = await runAuthorizationChange(GRANT_CATEGORY);

    expect(grant.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("İzinleriniz çözülemediği için");
  });

  it("oturum token'ı alınamadığında da göndermiyor", async () => {
    // Token bozuksa `getStaffContext()` onu ilk okuyan olduğu için red oradan
    // geliyor — `errorCode` `"SESSION"` değil `"UNEXPECTED"`. Test bunu olduğu
    // gibi yazıyor: kapının hangi katmanda kapandığını bilmek, kapandığını
    // bilmek kadar önemli.
    stubMe(["role.manage", "category.manage"]);
    const grant = watch("post", GRANT_PERMISSION);
    getKoalaAccessToken.mockRejectedValue(new Error("çerez yok"));

    const outcome = await runAuthorizationChange(GRANT_CATEGORY);

    expect(grant.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("UNEXPECTED");
    expect(outcome.message).toContain("hiçbir değişiklik yapılmadı");
  });
});

describe("form eksikse izin bile sorulmuyor", () => {
  it("boş bir rol kimliğiyle hiçbir istek yapmıyor", async () => {
    // `onUnhandledRequest: "error"` sayesinde bu iddia iki yönlü: `/admin/me`
    // stub'lanmadığı hâlde test geçiyorsa, izin de sorulmamış demektir.
    const grant = watch("post", GRANT_PERMISSION);

    const outcome = await runAuthorizationChange({ ...GRANT_CATEGORY, roleId: asRoleId("") });

    expect(grant.calls).toBe(0);
    expect(outcome.errorCode).toBe("PANEL_VALIDATION_FAILED");
  });

  it("kısa bir parolayı backend'e hiç göndermiyor", async () => {
    const create = watch("post", CREATE_STAFF);

    const outcome = await runAuthorizationChange({ ...CREATE, password: "kısa" });

    expect(create.calls).toBe(0);
    expect(outcome.field).toBe("password");
    expect(outcome.message).toContain("en az 12 karakter");
  });

  it("parola uzunluğunu kod noktasıyla sayıyor, UTF-16 birimiyle değil", async () => {
    // On iki emoji: `"…".length` 24 der ve testi yanlışlıkla geçirirdi.
    // Backend `codePointCount` kullanıyor, panel de öyle.
    const create = watch("post", CREATE_STAFF);

    const outcome = await runAuthorizationChange({ ...CREATE, password: "🐨".repeat(11) });

    expect(create.calls).toBe(0);
    expect(outcome.field).toBe("password");
  });

  it("UTF-8 olarak 72 baytı aşan parolayı göndermiyor", async () => {
    // BCrypt 72 bayttan sonrasını sessizce kırpar; 30 Türkçe harf 12 kod
    // noktası eşiğini geçer ama bayt sınırını aşabilir.
    const create = watch("post", CREATE_STAFF);

    const outcome = await runAuthorizationChange({ ...CREATE, password: "ğüşiöç".repeat(7) });

    expect(create.calls).toBe(0);
    expect(outcome.message).toContain("72 bayt");
  });

  it("parolanın baştaki ve sondaki boşluğunu kırpmıyor", async () => {
    // Kırpmak, kişinin yazdığından farklı bir parola kaydetmek olurdu.
    stubMe(["staff.manage"]);
    const create = watch("post", CREATE_STAFF, () =>
      HttpResponse.json({
        success: true,
        message: "Personel oluşturuldu.",
        httpStatus: "201 CREATED",
        path: "/admin/staff",
        requestId: "rid-create",
        timeStamp: "2026-09-08T09:00:00.000000000Z",
        data: {
          id: STAFF_ID,
          email: "yeni@koala.local",
          displayName: "Yeni Personel",
          active: true,
          mustChangePassword: true,
          lockedUntil: null,
          createdAt: "2026-09-08T09:00:00Z",
          roles: [],
        },
      }),
    );

    await runAuthorizationChange({ ...CREATE, password: `  ${GOOD_PASSWORD}  ` });

    expect(create.calls).toBe(1);
    expect(JSON.parse(create.body ?? "{}").password).toBe(`  ${GOOD_PASSWORD}  `);
  });
});

describe("izin varsa istek gerçekten yapılıyor", () => {
  it("izni role veriyor ve gövdeyi backend'in beklediği biçimde gönderiyor", async () => {
    stubMe(["role.manage", "category.manage"]);
    const grant = watch("post", GRANT_PERMISSION);

    const outcome = await runAuthorizationChange(GRANT_CATEGORY);

    expect(grant.calls).toBe(1);
    expect(JSON.parse(grant.body ?? "{}")).toEqual({ permission: "category.manage" });
    expect(outcome.status).toBe("SUCCEEDED");
    // Denetim kaydındaki adı söylüyor ki operatör o satırı arayabilsin.
    expect(outcome.message).toContain("staff.role.permission.grant");
  });

  it("kapsamayı gövdesinde includedRoleId ile ekliyor", async () => {
    stubMe(["role.manage"]);
    const include = watch("post", ADD_INCLUDE);

    await runAuthorizationChange({
      kind: "ROLE_INCLUDE_ADD",
      roleId: ROLE_ID,
      roleCode: TRUST_LEAD,
      includedRoleId: CHILD_ROLE_ID,
      includedRoleCode: FINANCE_OFFICER,
    });

    expect(include.calls).toBe(1);
    expect(JSON.parse(include.body ?? "{}")).toEqual({ includedRoleId: CHILD_ROLE_ID });
  });

  it("rol üyeliğini kodla adresliyor, UUID ile değil", async () => {
    // `@PathVariable String roleCode`. UUID göndermek 404 STAFF_ROLE_NOT_FOUND.
    stubMe(["staff.manage"]);
    let path = "";
    server.use(
      http.post(STAFF_ROLE, ({ request }) => {
        path = new URL(request.url).pathname;
        return ok();
      }),
    );

    await runAuthorizationChange({
      kind: "STAFF_ROLE_GRANT",
      staffId: STAFF_ID,
      staffLabel: "Bir Personel",
      roleCode: SUPPORT_AGENT,
    });

    expect(path).toBe(`/admin/staff/${STAFF_ID}/roles/SUPPORT_AGENT`);
  });

  it("devre dışı bırakmayı PATCH gövdesiyle yapıyor ve sonucunu anlatıyor", async () => {
    stubMe(["staff.manage"]);
    const patch = watch("patch", PATCH_STAFF, () =>
      HttpResponse.json({
        success: true,
        message: "Personel güncellendi.",
        httpStatus: "200 OK",
        path: `/admin/staff/${STAFF_ID}`,
        requestId: "rid-patch",
        timeStamp: "2026-09-08T09:00:00.000000000Z",
        data: {
          id: STAFF_ID,
          email: "biri@koala.local",
          displayName: "Bir Personel",
          active: false,
          mustChangePassword: false,
          lockedUntil: null,
          createdAt: "2026-09-08T09:00:00Z",
          roles: ["SUPPORT_AGENT"],
        },
      }),
    );

    const outcome = await runAuthorizationChange({
      kind: "STAFF_SET_ACTIVE",
      staffId: STAFF_ID,
      staffLabel: "Bir Personel",
      active: false,
    });

    expect(patch.calls).toBe(1);
    expect(JSON.parse(patch.body ?? "{}")).toEqual({ active: false });
    // Kabul maddesi: "devre dışı bırakılan personel giriş yapamaz". Bunu
    // yapan şey token sürümünün artması, ve ekran bunu söylüyor.
    expect(outcome.message).toContain("giriş denemesi de reddedilir");
  });
});

describe("backend reddi bir hata kodu değil bir cümle olarak dönüyor", () => {
  it("döngüyü anlaşılır biçimde açıklıyor ve kodu ile istek numarasını taşıyor", async () => {
    stubMe(["role.manage"]);
    watch("post", ADD_INCLUDE, () =>
      refusal(409, "STAFF_ROLE_GRAPH_WOULD_CYCLE", "Bu kapsama rol grafiğinde döngü oluşturur."),
    );

    const outcome = await runAuthorizationChange({
      kind: "ROLE_INCLUDE_ADD",
      roleId: ROLE_ID,
      roleCode: SUPPORT_AGENT,
      includedRoleId: CHILD_ROLE_ID,
      includedRoleCode: TRUST_LEAD,
    });

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.message).toContain("döngü oluşturur");
    expect(outcome.message).toContain("kendi kendini içerirdi");
    expect(outcome.errorCode).toBe("STAFF_ROLE_GRAPH_WOULD_CYCLE");
    expect(outcome.requestId).toBe("rid-STAFF_ROLE_GRAPH_WOULD_CYCLE");
  });

  it("sahip olmadığın izni verememeyi kuralıyla birlikte anlatıyor", async () => {
    stubMe(["role.manage"]);
    watch("post", GRANT_PERMISSION, () =>
      refusal(
        403,
        "STAFF_PERMISSION_NOT_GRANTABLE",
        "Sahip olmadığınız bir izni bir role veremezsiniz.",
      ),
    );

    const outcome = await runAuthorizationChange({
      ...GRANT_CATEGORY,
      permission: "payout.release",
    });

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.message).toContain("veremez, ondan alamaz");
  });

  it("rol tarafındaki kendini kilitleme korumasının sahip saymadığını söylüyor", async () => {
    // Kuralın adı "son sahip" der, davranışı değildir: kalan sahipler
    // sayılmıyor. Operatör bunu bilmezse 409'u bir hata sanır.
    stubMe(["role.manage"]);
    watch("delete", REVOKE_PERMISSION, () =>
      refusal(
        409,
        "STAFF_ROLE_MANAGE_SELF_LOCKOUT",
        "Rol yönetimi iznini kendi ulaştığınız bir rolden kaldıramazsınız; rol grafiğine erişiminizi kaybederdiniz.",
      ),
    );

    const outcome = await runAuthorizationChange({
      ...REVOKE_CATEGORY,
      permission: "role.manage",
    });

    expect(outcome.message).toContain("kalan sahipleri saymıyor");
  });

  it("üyelik tarafındaki kendini kilitlemeyi hangi ikilinin arandığıyla anlatıyor", async () => {
    stubMe(["staff.manage"]);
    watch("delete", STAFF_ROLE, () =>
      refusal(
        409,
        "STAFF_MEMBERSHIP_SELF_LOCKOUT",
        "Kendi son yönetim üyeliğinizi bırakamazsınız; panele erişiminizi kaybederdiniz.",
      ),
    );

    const outcome = await runAuthorizationChange({
      kind: "STAFF_ROLE_REVOKE",
      staffId: STAFF_ID,
      staffLabel: "Ben",
      roleCode: OWNER,
    });

    expect(outcome.message).toContain("staff.manage + role.manage");
  });

  it("sistemde son yönetici kalmayacağını ayrı bir cümleyle söylüyor", async () => {
    stubMe(["staff.manage"]);
    watch("patch", PATCH_STAFF, () =>
      refusal(
        409,
        "STAFF_LAST_ADMINISTRATOR",
        "Sistemde yönetim izni taşıyan başka etkin personel kalmıyor.",
      ),
    );

    const outcome = await runAuthorizationChange({
      kind: "STAFF_SET_ACTIVE",
      staffId: STAFF_ID,
      staffLabel: "Son Yönetici",
      active: false,
    });

    expect(outcome.errorCode).toBe("STAFF_LAST_ADMINISTRATOR");
    expect(outcome.message).toContain("etkin hiçbir personel kalmıyordu");
  });

  it("yinelenen e-postayı e-posta alanına bağlıyor", async () => {
    stubMe(["staff.manage"]);
    watch("post", CREATE_STAFF, () =>
      refusal(
        409,
        "STAFF_EMAIL_ALREADY_REGISTERED",
        "Bu e-posta ile kayıtlı bir personel zaten var.",
      ),
    );

    const outcome = await runAuthorizationChange(CREATE);

    expect(outcome.field).toBe("email");
  });

  it("doğrulama ayrıntısını gösteriyor ve getter'dan türeyen alan adını düzeltiyor", async () => {
    // `@AssertTrue public boolean isPermissionKnown()` tel üzerinde
    // `permissionKnown` diyor; formdaki kontrolün adı `permission`.
    stubMe(["role.manage", "category.manage"]);
    watch("post", GRANT_PERMISSION, () =>
      HttpResponse.json(
        {
          success: false,
          message: "Doğrulama başarısız.",
          httpStatus: "400 BAD_REQUEST",
          errorCode: "VALIDATION_FAILED",
          errorCategory: "VALIDATION_FAILED",
          requestId: "rid-400",
          path: "/admin/roles",
          timeStamp: "2026-09-08T09:00:00.000000000Z",
          details: [{ field: "permissionKnown", message: "Tanınmayan izin kodu." }],
        },
        { status: 400 },
      ),
    );

    const outcome = await runAuthorizationChange(GRANT_CATEGORY);

    expect(outcome.field).toBe("permission");
    expect(outcome.message).toContain("Tanınmayan izin kodu.");
  });

  it("tanımadığı bir reddi yine de backend'in cümlesiyle gösteriyor", async () => {
    // Backend yeni bir hata kodu tanımladığında ekran boş kalmamalı.
    stubMe(["role.manage"]);
    watch("post", ADD_INCLUDE, () =>
      refusal(409, "STAFF_BRAND_NEW_RULE", "Yepyeni bir kural bunu engelledi."),
    );

    const outcome = await runAuthorizationChange({
      kind: "ROLE_INCLUDE_ADD",
      roleId: ROLE_ID,
      roleCode: TRUST_LEAD,
      includedRoleId: CHILD_ROLE_ID,
      includedRoleCode: FINANCE_OFFICER,
    });

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.message).toBe("Yepyeni bir kural bunu engelledi.");
    expect(outcome.errorCode).toBe("STAFF_BRAND_NEW_RULE");
  });
});

describe("görev ayrılığı burada bir kural değil", () => {
  /**
   * Buradaki iki test bir **eksikliği** sabitliyor: koala-backend ADR-0014'ün
   * görev ayrılığı kuralını çalışma anında uygulamıyor, ve panel de onu taklit
   * etmiyor. Panel burada dursaydı ekran yalan söylerdi — aynı yazım `curl`
   * ile geçerken operatör onun engellendiğini sanırdı. Teşhis ekranda
   * (`role-graph.ts`, `/roles` ve `/staff` uyarıları), kapıda değil.
   *
   * **Eksik `is-koala/koala-backend#133` olarak açıldı.** O issue merge
   * edildiği gün bu iki iddia da yanlış olacak: backend yazımı reddedecek,
   * `include.calls`/`grant.calls` yine 1 kalacak ama sonuç `REFUSED` olacak ve
   * panelin ekrandaki "backend bunu kabul eder" cümlelerinin de değişmesi
   * gerekecek. Bağ buraya yazılı ki o gün kimse bunu aramak zorunda kalmasın.
   */
  it("iki dalı birleştiren kapsamayı gönderiyor, çünkü backend onu kabul ediyor", async () => {
    stubMe(["role.manage"]);
    const include = watch("post", ADD_INCLUDE);

    const outcome = await runAuthorizationChange({
      kind: "ROLE_INCLUDE_ADD",
      roleId: ROLE_ID,
      roleCode: TRUST_LEAD,
      includedRoleId: CHILD_ROLE_ID,
      includedRoleCode: FINANCE_OFFICER,
    });

    expect(include.calls).toBe(1);
    expect(outcome.status).toBe("SUCCEEDED");
  });

  it("iki dalı birleştiren rol atamasını da gönderiyor", async () => {
    /**
     * Üyelik tarafı, ve kuralın insanın eliyle en kolay bozulduğu yer: bir
     * kişiye TRUST_LEAD'in yanına FINANCE_OFFICER vermek. `grantRole` yalnız
     * "sahip olmadığın izni veremezsin" kuralını denetliyor; birleşim
     * kabul ediliyor.
     */
    stubMe(["staff.manage"]);
    const grant = watch("post", STAFF_ROLE);

    const outcome = await runAuthorizationChange({
      kind: "STAFF_ROLE_GRANT",
      staffId: STAFF_ID,
      staffLabel: "Güven Lideri",
      roleCode: FINANCE_OFFICER,
    });

    expect(grant.calls).toBe(1);
    expect(outcome.status).toBe("SUCCEEDED");
  });
});

const GRANT_USER_ADMIN = {
  kind: "USER_ROLE_GRANT",
  userId: MARKETPLACE_USER_ID,
  userLabel: "Ada Yılmaz",
  role: "ROLE_ADMIN",
} as const;

const REVOKE_USER_ADMIN = {
  kind: "USER_ROLE_REVOKE",
  userId: MARKETPLACE_USER_ID,
  userLabel: "Ada Yılmaz",
  role: "ROLE_ADMIN",
} as const;

function grantsOk(): Response {
  return HttpResponse.json({
    success: true,
    message: "Rol verildi.",
    httpStatus: "200 OK",
    path: `/admin/users/${MARKETPLACE_USER_ID}/roles`,
    requestId: "rid-user-role",
    timeStamp: "2026-09-11T14:00:00.000000000Z",
    data: [
      {
        role: "ROLE_USER",
        grantedAt: "2026-01-01T08:00:00Z",
        grantedById: null,
        grantedByName: null,
      },
      {
        role: "ROLE_ADMIN",
        grantedAt: "2026-09-11T14:00:00Z",
        grantedById: null,
        grantedByName: null,
      },
    ],
  });
}

describe("pazaryeri kullanıcı rolleri user.role.manage ister", () => {
  it("user.read taşıyan ama user.role.manage taşımayan biri grant/revoke göndermez", async () => {
    stubMe(["user.read"]);
    const grant = watch("post", USER_ROLES, grantsOk);
    const revoke = watch("delete", USER_ROLE);

    const outcomes = await Promise.all([
      runAuthorizationChange(GRANT_USER_ADMIN),
      runAuthorizationChange(REVOKE_USER_ADMIN),
    ]);

    expect(grant.calls).toBe(0);
    expect(revoke.calls).toBe(0);
    expect(outcomes.map((outcome) => outcome.status)).toEqual(["BLOCKED", "BLOCKED"]);
    expect(outcomes[0]?.message).toContain("Kullanıcı rollerini yönet");
  });

  it("personel rol izni pazaryeri yazımını açmaz", async () => {
    stubMe(["staff.manage", "role.manage"]);
    const grant = watch("post", USER_ROLES, grantsOk);

    const outcome = await runAuthorizationChange(GRANT_USER_ADMIN);

    expect(grant.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
  });

  it("bilinmeyen bir rol adını backend'e hiç göndermez", async () => {
    const grant = watch("post", USER_ROLES, grantsOk);

    const outcome = await runAuthorizationChange({
      ...GRANT_USER_ADMIN,
      role: "OWNER",
    });

    expect(grant.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("role");
  });

  it("GrantRoleDto gövdesini { role } olarak gönderir", async () => {
    stubMe(["user.role.manage"]);
    const grant = watch("post", USER_ROLES, grantsOk);

    const outcome = await runAuthorizationChange(GRANT_USER_ADMIN);

    expect(grant.calls).toBe(1);
    expect(JSON.parse(grant.body ?? "{}")).toEqual({ role: "ROLE_ADMIN" });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("user.role.grant");
  });

  it("geri almayı path'teki enum adıyla yapar", async () => {
    stubMe(["user.role.manage"]);
    let path = "";
    server.use(
      http.delete(USER_ROLE, ({ request }) => {
        path = new URL(request.url).pathname;
        return ok();
      }),
    );

    const outcome = await runAuthorizationChange(REVOKE_USER_ADMIN);

    expect(path).toBe(`/admin/users/${MARKETPLACE_USER_ID}/roles/ROLE_ADMIN`);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("user.role.revoke");
  });
});

describe("korunan pazaryeri rolleri 409'u operatör dilinde gösterir", () => {
  it.each([
    [
      "ADMIN_USER_ROLE_SYSTEM_PROTECTED",
      "Sistem kullanıcısının rolleri değiştirilemez.",
      "bildirim ve anonimleştirme",
    ],
    [
      "ADMIN_USER_ROLE_LAST_ADMIN_PROTECTED",
      "Sistemdeki son yönetici rolü geri alınamaz.",
      "sıfır adminli sistem",
    ],
    [
      "ADMIN_USER_ROLE_OWN_ADMIN_PROTECTED",
      "Bir yönetici kendi yönetici rolünü geri alamaz.",
      "Personel aktör",
    ],
    [
      "ADMIN_USER_ROLE_MEMBERSHIP_PROTECTED",
      "Üyelik rolü bu uçtan geri alınamaz.",
      "ROLE_USER pazaryeri üyeliğinin taşıyıcısıdır",
    ],
  ] as const)("explains %s", async (errorCode, backendMessage, explanation) => {
    stubMe(["user.role.manage"]);
    watch("delete", USER_ROLE, () => refusal(409, errorCode, backendMessage));

    const outcome = await runAuthorizationChange({
      ...REVOKE_USER_ADMIN,
      role: errorCode === "ADMIN_USER_ROLE_MEMBERSHIP_PROTECTED" ? "ROLE_USER" : "ROLE_ADMIN",
    });

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.message).toContain(backendMessage);
    expect(outcome.message).toContain(explanation);
    expect(outcome.errorCode).toBe(errorCode);
  });
});
