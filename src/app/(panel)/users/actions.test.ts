import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { IDLE_AUTHORIZATION_OUTCOME } from "@/lib/authorization-change";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const revalidatePath = vi.fn<(path: string) => void>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { grantMarketplaceRole, revokeMarketplaceRole } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const USER_ROLES = apiUrl(`/admin/users/${USER_ID}/roles`);
const USER_ROLE = apiUrl(`/admin/users/${USER_ID}/roles/:role`);

const GRANTS = [
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
];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  revalidatePath.mockReset();
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

function watch(method: "post" | "delete", url: string) {
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
        path: seen.path,
        requestId: "rid-ok",
        timeStamp: "2026-09-11T14:00:00.000000000Z",
        ...(method === "post" ? { data: GRANTS } : {}),
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

describe("pazaryeri rol yazımları izni yeniden çözer", () => {
  it("user.read ile grant backend'e gitmez", async () => {
    stubMe(["user.read"]);
    const grant = watch("post", USER_ROLES);

    const outcome = await grantMarketplaceRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ userId: USER_ID, userLabel: "Ada", role: "ROLE_ADMIN" }),
    );

    expect(grant.calls).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("user.role.manage ile ROLE_ADMIN verir ve dizini yeniler", async () => {
    stubMe(["user.role.manage"]);
    const grant = watch("post", USER_ROLES);

    const outcome = await grantMarketplaceRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ userId: USER_ID, userLabel: "Ada Yılmaz", role: "ROLE_ADMIN" }),
    );

    expect(grant.calls).toBe(1);
    expect(JSON.parse(grant.body ?? "{}")).toEqual({ role: "ROLE_ADMIN" });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/users/${USER_ID}`,
      "/users",
      "/",
    ]);
  });

  it("geri almayı path'teki rolle yapar", async () => {
    stubMe(["user.role.manage"]);
    const revoke = watch("delete", USER_ROLE);

    const outcome = await revokeMarketplaceRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ userId: USER_ID, userLabel: "Ada Yılmaz", role: "ROLE_ADMIN" }),
    );

    expect(revoke.calls).toBe(1);
    expect(revoke.path).toBe(`/admin/users/${USER_ID}/roles/ROLE_ADMIN`);
    expect(outcome.status).toBe("SUCCEEDED");
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/users/${USER_ID}`,
      "/users",
      "/",
    ]);
  });

  it("ikinci gönderim 409 ile durur ve dizini yeniden yenilemez", async () => {
    stubMe(["user.role.manage"]);
    watch("post", USER_ROLES);

    const first = await grantMarketplaceRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ userId: USER_ID, userLabel: "Ada Yılmaz", role: "ROLE_ADMIN" }),
    );
    expect(first.status).toBe("SUCCEEDED");
    revalidatePath.mockClear();

    server.use(
      http.post(USER_ROLES, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Rol zaten verilmiş.",
            httpStatus: "409 CONFLICT",
            errorCode: "ADMIN_USER_ROLE_ALREADY_GRANTED",
            errorCategory: "DATA_CONFLICT",
            requestId: "rid-409-replay",
            path: `/admin/users/${USER_ID}/roles`,
            timeStamp: "2026-09-11T14:00:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const second = await grantMarketplaceRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ userId: USER_ID, userLabel: "Ada Yılmaz", role: "ROLE_ADMIN" }),
    );

    expect(second.status).toBe("REFUSED");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("reddedilen yazım dizini yenilemez", async () => {
    stubMe(["user.role.manage"]);
    server.use(
      http.delete(USER_ROLE, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Üyelik rolü bu uçtan geri alınamaz.",
            httpStatus: "409 CONFLICT",
            errorCode: "ADMIN_USER_ROLE_MEMBERSHIP_PROTECTED",
            errorCategory: "DATA_CONFLICT",
            requestId: "rid-409",
            path: `/admin/users/${USER_ID}/roles/ROLE_USER`,
            timeStamp: "2026-09-11T14:00:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const outcome = await revokeMarketplaceRole(
      IDLE_AUTHORIZATION_OUTCOME,
      form({ userId: USER_ID, userLabel: "Ada", role: "ROLE_USER" }),
    );

    expect(outcome.status).toBe("REFUSED");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
