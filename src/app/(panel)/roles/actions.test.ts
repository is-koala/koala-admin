import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

/**
 * Formdan kapıya giden yol.
 *
 * `administration.test.ts` kapının kendisini ölçüyor; burada ölçülen şey
 * formun taşıdığı alanların doğru okunduğu — özellikle tek bir `<select>`'in
 * iki bilgiyi (`uuid:KOD`) nasıl taşıdığı. Yanlış ayrıştırılırsa backend'e
 * boş bir `includedRoleId` giderdi ve 400 dönerdi; bu testler onu ayrıştırma
 * hatası olarak yakalıyor, gizemli bir 400 olarak değil.
 *
 * Kapı iddiası burada da var ve yine istek sayısıyla: izinsiz bir gönderim
 * hiçbir istek yapmamalı.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { IDLE_AUTHORIZATION_OUTCOME } = await import("@/lib/authorization-change");
const { addRoleInclude, grantPermissionToRole, removeRoleInclude, revokePermissionFromRole } =
  await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const ROLE_ID = "9a1c0f10-0003-4c00-8000-000000000008";
const CHILD_ID = "9a1c0f10-0003-4c00-8000-000000000009";

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

function ok(): Response {
  return HttpResponse.json({
    success: true,
    message: "Tamam.",
    httpStatus: "200 OK",
    path: "/admin/roles",
    requestId: "rid-ok",
    timeStamp: "2026-09-08T09:00:00.000000000Z",
  });
}

function watch(method: "post" | "delete", url: string) {
  const seen = { calls: 0, body: null as string | null, path: "" };

  server.use(
    http[method](url, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.text();
      seen.path = new URL(request.url).pathname;
      return ok();
    }),
  );

  return seen;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("izin formunun alanları", () => {
  it("izni verirken gövdeye yalnız izin adını koyuyor", async () => {
    stubMe(["role.manage", "category.manage"]);
    const grant = watch("post", apiUrl(`/admin/roles/${ROLE_ID}/permissions`));

    const outcome = await grantPermissionToRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ roleId: ROLE_ID, roleCode: "TRUST_LEAD", permission: "category.manage" }),
    );

    expect(grant.calls).toBe(1);
    expect(JSON.parse(grant.body ?? "{}")).toEqual({ permission: "category.manage" });
    expect(outcome.status).toBe("SUCCEEDED");
  });

  it("izni geri alırken adı yola koyuyor ve gövde göndermiyor", async () => {
    // `DELETE /admin/roles/{roleId}/permissions/{permission}` — gövdesi yok.
    stubMe(["role.manage", "category.manage"]);
    const revoke = watch("delete", apiUrl(`/admin/roles/${ROLE_ID}/permissions/:permission`));

    await revokePermissionFromRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ roleId: ROLE_ID, roleCode: "TRUST_LEAD", permission: "category.manage" }),
    );

    expect(revoke.calls).toBe(1);
    expect(revoke.path).toBe(`/admin/roles/${ROLE_ID}/permissions/category.manage`);
    expect(revoke.body).toBe("");
  });

  it("izin adı yoksa hiçbir istek yapmıyor", async () => {
    const grant = watch("post", apiUrl(`/admin/roles/${ROLE_ID}/permissions`));

    const outcome = await grantPermissionToRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ roleId: ROLE_ID, roleCode: "TRUST_LEAD" }),
    );

    expect(grant.calls).toBe(0);
    expect(outcome.field).toBe("permission");
  });
});

describe("kapsama seçeneği iki bilgiyi birden taşıyor", () => {
  it("uuid:KOD çiftini ayırıp UUID'yi gövdeye, kodu mesaja koyuyor", async () => {
    stubMe(["role.manage"]);
    const include = watch("post", apiUrl(`/admin/roles/${ROLE_ID}/includes`));

    const outcome = await addRoleInclude(
      IDLE_AUTHORIZATION_OUTCOME,
      form({
        roleId: ROLE_ID,
        roleCode: "TRUST_LEAD",
        includedRole: `${CHILD_ID}:FINANCE_OFFICER`,
      }),
    );

    expect(include.calls).toBe(1);
    expect(JSON.parse(include.body ?? "{}")).toEqual({ includedRoleId: CHILD_ID });
    expect(outcome.message).toContain("FINANCE_OFFICER");
  });

  it("çift bozuksa istek yapmıyor", async () => {
    /**
     * Ayrıştırma hatası bir 400 olarak değil, bir form hatası olarak görünsün.
     *
     * Test eskiden yalnız boş dizeyi deniyordu ve başlığının söylediği şeyi
     * ölçmüyordu: iki noktası **olmayan** bir değer (`"COPUK"`) ayrıştırmadan
     * geçiyor, istek gövdesi `{"includedRoleId":"COPUK"}` olarak gidiyor ve
     * başarı cümlesi rolün adı olması gereken yerde boşlukla çiziliyordu —
     * "TRUST_LEAD artık  rolünü kapsıyor". Bozuk çiftin her hâli burada.
     *
     * İzin bilerek veriliyor: durduran şeyin kapı değil ayrıştırma olduğu
     * görünsün diye.
     */
    stubMe(["role.manage"]);
    const include = watch("post", apiUrl(`/admin/roles/${ROLE_ID}/includes`));

    const broken = ["", "COPUK", `${CHILD_ID}:`, ":FINANCE_OFFICER", `${CHILD_ID}:A:B`];

    for (const value of broken) {
      const outcome = await addRoleInclude(
        IDLE_AUTHORIZATION_OUTCOME,
        form({ roleId: ROLE_ID, roleCode: "TRUST_LEAD", includedRole: value }),
      );

      expect(include.calls, value).toBe(0);
      expect(outcome.status, value).toBe("BLOCKED");
      // Mesaj formdaki kontrolün adına asılıyor: `<select name="includedRole">`.
      expect(outcome.field, value).toBe("includedRole");
      // Ve hiçbir şey "yapıldı" diye anlatılmıyor.
      expect(outcome.message, value).not.toContain("kapsıyor");
    }
  });

  it("kodu boş gelen bir kaldırma isteğini de göndermiyor", async () => {
    // Kod isteğe değil cevabın cümlesine gidiyor; boş bir kod, yapılan işin
    // adının ekranda boşluk olması demek.
    stubMe(["role.manage"]);
    const exclude = watch("delete", apiUrl(`/admin/roles/${ROLE_ID}/includes/${CHILD_ID}`));

    const outcome = await removeRoleInclude(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ roleId: ROLE_ID, roleCode: "TRUST_LEAD", includedRoleId: CHILD_ID }),
    );

    expect(exclude.calls).toBe(0);
    expect(outcome.field).toBe("includedRole");
  });

  it("kapsamayı kaldırırken kimliği yola koyuyor", async () => {
    stubMe(["role.manage"]);
    const exclude = watch("delete", apiUrl(`/admin/roles/${ROLE_ID}/includes/${CHILD_ID}`));

    await removeRoleInclude(
      IDLE_AUTHORIZATION_OUTCOME,
      form({
        roleId: ROLE_ID,
        roleCode: "TRUST_LEAD",
        includedRoleId: CHILD_ID,
        includedRoleCode: "FINANCE_OFFICER",
      }),
    );

    expect(exclude.calls).toBe(1);
    expect(exclude.path).toBe(`/admin/roles/${ROLE_ID}/includes/${CHILD_ID}`);
  });
});

describe("izin olmadan hiçbir eylem istek yapmıyor", () => {
  it("dördü de sessizce duruyor", async () => {
    stubMe(["staff.read"]);
    const calls = [
      watch("post", apiUrl(`/admin/roles/${ROLE_ID}/permissions`)),
      watch("delete", apiUrl(`/admin/roles/${ROLE_ID}/permissions/:permission`)),
      watch("post", apiUrl(`/admin/roles/${ROLE_ID}/includes`)),
      watch("delete", apiUrl(`/admin/roles/${ROLE_ID}/includes/${CHILD_ID}`)),
    ];

    const base = { roleId: ROLE_ID, roleCode: "TRUST_LEAD" };
    await Promise.all([
      grantPermissionToRole(IDLE_AUTHORIZATION_OUTCOME, form({ ...base, permission: "user.read" })),
      revokePermissionFromRole(
        IDLE_AUTHORIZATION_OUTCOME,
        form({ ...base, permission: "user.read" }),
      ),
      addRoleInclude(
        IDLE_AUTHORIZATION_OUTCOME,
        form({ ...base, includedRole: `${CHILD_ID}:FINANCE_OFFICER` }),
      ),
      removeRoleInclude(
        IDLE_AUTHORIZATION_OUTCOME,
        form({ ...base, includedRoleId: CHILD_ID, includedRoleCode: "FINANCE_OFFICER" }),
      ),
    ]);

    expect(calls.map((call) => call.calls)).toEqual([0, 0, 0, 0]);
  });
});
