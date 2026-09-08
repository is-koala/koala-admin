import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

/**
 * Personel formlarından kapıya giden yol.
 *
 * Buradaki iki iddia kolayca ters gidebilecek türden:
 *
 *  - **Parola kırpılmıyor.** Kırpmak, kişinin yazdığından farklı bir parola
 *    kaydetmek ve sonra girişte "yanlış parola" demek olurdu; hata da parolayı
 *    yazan kişide değil, panelde olurdu.
 *  - **`active` yalnız `"true"` iken etkinleştiriyor.** Bozuk bir form alanı
 *    kimseyi sessizce geri açmasın.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { IDLE_AUTHORIZATION_OUTCOME } = await import("@/lib/authorization-change");
const {
  createStaff,
  grantRoleToStaff,
  resetStaffPasswordAction,
  revokeRoleFromStaff,
  setStaffActive,
} = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const STAFF_ID = "b7f4a2c1-0000-4c00-8000-000000000077";
const GOOD_PASSWORD = "kedi-koala-2026!";

const MEMBER = {
  id: STAFF_ID,
  email: "yeni@koala.local",
  displayName: "Yeni Personel",
  active: true,
  mustChangePassword: true,
  lockedUntil: null,
  createdAt: "2026-09-08T09:00:00Z",
  roles: [],
};

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

function watch(method: "post" | "delete" | "patch", url: string, data?: unknown) {
  const seen = { calls: 0, body: null as string | null, path: "" };

  server.use(
    http[method](url, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.text();
      seen.path = new URL(request.url).pathname;
      return HttpResponse.json({
        success: true,
        message: "Tamam.",
        httpStatus: "200 OK",
        path: "/admin/staff",
        requestId: "rid-ok",
        timeStamp: "2026-09-08T09:00:00.000000000Z",
        ...(data === undefined ? {} : { data }),
      });
    }),
  );

  return seen;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

describe("personel oluşturma", () => {
  it("e-postayı, adı ve parolayı backend'in beklediği gövdede gönderiyor", async () => {
    stubMe(["staff.manage"]);
    const create = watch("post", apiUrl("/admin/staff"), MEMBER);

    const outcome = await createStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ email: "yeni@koala.local", displayName: "Yeni Personel", password: GOOD_PASSWORD }),
    );

    expect(create.calls).toBe(1);
    expect(JSON.parse(create.body ?? "{}")).toEqual({
      email: "yeni@koala.local",
      displayName: "Yeni Personel",
      password: GOOD_PASSWORD,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    // Kabul maddesi değil ama ekranın söylemesi gereken şey: yeni hesap hiçbir
    // ekrana ulaşamaz, çünkü rolü yok.
    expect(outcome.message).toContain("henüz hiçbir rolü yok");
  });

  it("görünen ad boşsa alanı hiç göndermiyor", async () => {
    stubMe(["staff.manage"]);
    const create = watch("post", apiUrl("/admin/staff"), MEMBER);

    await createStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ email: "yeni@koala.local", displayName: "   ", password: GOOD_PASSWORD }),
    );

    expect(Object.keys(JSON.parse(create.body ?? "{}"))).toEqual(["email", "password"]);
  });

  it("parolanın boşluklarını kırpmıyor", async () => {
    stubMe(["staff.manage"]);
    const create = watch("post", apiUrl("/admin/staff"), MEMBER);
    const padded = ` ${GOOD_PASSWORD} `;

    await createStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ email: "yeni@koala.local", password: padded }),
    );

    expect(JSON.parse(create.body ?? "{}").password).toBe(padded);
  });

  it("staff.manage yoksa hiçbir istek yapmıyor", async () => {
    stubMe(["staff.read"]);
    const create = watch("post", apiUrl("/admin/staff"), MEMBER);

    const outcome = await createStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ email: "yeni@koala.local", password: GOOD_PASSWORD }),
    );

    expect(create.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
  });
});

describe("etkinlik durumu", () => {
  it("active alanı 'true' değilse devre dışı bırakıyor", async () => {
    // Bozuk bir alan kimseyi sessizce geri açmasın: tek doğru değer "true".
    stubMe(["staff.manage"]);
    const patch = watch("patch", apiUrl(`/admin/staff/${STAFF_ID}`), MEMBER);

    await setStaffActive(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri", active: "TRUE" }),
    );

    expect(JSON.parse(patch.body ?? "{}")).toEqual({ active: false });
  });

  it("'true' geldiğinde etkinleştiriyor", async () => {
    stubMe(["staff.manage"]);
    const patch = watch("patch", apiUrl(`/admin/staff/${STAFF_ID}`), MEMBER);

    const outcome = await setStaffActive(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri", active: "true" }),
    );

    expect(JSON.parse(patch.body ?? "{}")).toEqual({ active: true });
    expect(outcome.message).toContain("yeniden etkinleştirildi");
  });
});

describe("rol üyeliği", () => {
  it("rolü kodla veriyor ve gövde göndermiyor", async () => {
    stubMe(["staff.manage"]);
    const grant = watch("post", apiUrl(`/admin/staff/${STAFF_ID}/roles/:roleCode`));

    await grantRoleToStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri", roleCode: "SUPPORT_AGENT" }),
    );

    expect(grant.path).toBe(`/admin/staff/${STAFF_ID}/roles/SUPPORT_AGENT`);
    expect(grant.body).toBe("");
  });

  it("rolü geri alırken iptalin anında geçerli olduğunu söylüyor", async () => {
    stubMe(["staff.manage"]);
    watch("delete", apiUrl(`/admin/staff/${STAFF_ID}/roles/:roleCode`));

    const outcome = await revokeRoleFromStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri", roleCode: "SUPPORT_AGENT" }),
    );

    expect(outcome.message).toContain("iptal anında geçerli");
  });

  it("rol kodu yoksa istek yapmıyor", async () => {
    const grant = watch("post", apiUrl(`/admin/staff/${STAFF_ID}/roles/:roleCode`));

    const outcome = await grantRoleToStaff(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri" }),
    );

    expect(grant.calls).toBe(0);
    expect(outcome.field).toBe("roleCode");
  });
});

describe("parola atama", () => {
  it("parolayı gövdede gönderiyor ve sonuçlarını sayıyor", async () => {
    stubMe(["staff.manage"]);
    const reset = watch("post", apiUrl(`/admin/staff/${STAFF_ID}/password`));

    const outcome = await resetStaffPasswordAction(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri", password: GOOD_PASSWORD }),
    );

    expect(reset.calls).toBe(1);
    expect(JSON.parse(reset.body ?? "{}")).toEqual({ password: GOOD_PASSWORD });
    expect(outcome.message).toContain("açık oturumları sonlandırıldı");
    expect(outcome.message).toContain("panel dışından");
  });

  it("kısa parolayı backend'e hiç göndermiyor", async () => {
    const reset = watch("post", apiUrl(`/admin/staff/${STAFF_ID}/password`));

    const outcome = await resetStaffPasswordAction(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ staffId: STAFF_ID, staffLabel: "Biri", password: "kısa" }),
    );

    expect(reset.calls).toBe(0);
    expect(outcome.field).toBe("password");
  });
});
