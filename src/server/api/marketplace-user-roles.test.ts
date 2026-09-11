import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { isKoalaApiError } from "./errors";
import {
  getMarketplaceUserRoles,
  grantMarketplaceUserRole,
  marketplaceUserRolesPath,
  revokeMarketplaceUserRole,
} from "./marketplace-user-roles";

const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";

function envelope(path: string, data: unknown) {
  return {
    success: true,
    message: "Tamam.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-roles",
    timeStamp: "2026-09-11T14:00:00.000000000Z",
    data,
  };
}

const GRANTS = [
  {
    role: "ROLE_USER",
    grantedAt: "2026-01-01T08:00:00.000000000Z",
    grantedById: "00000000-0000-0000-0000-000000000001",
    grantedByName: "Sistem",
  },
  {
    role: "ROLE_ADMIN",
    grantedAt: "2026-09-11T14:00:00.000000000Z",
    grantedById: null,
    grantedByName: null,
  },
];

describe("the paths match AdminController, not the issue prose", () => {
  it("lists, grants and revokes under /admin/users/{id}/roles", () => {
    expect(marketplaceUserRolesPath(USER_ID)).toBe(`/admin/users/${USER_ID}/roles`);
  });

  it("escapes the user id rather than pasting it into the URL", () => {
    expect(marketplaceUserRolesPath("a/../b")).toBe("/admin/users/a%2F..%2Fb/roles");
  });
});

describe("listing grants", () => {
  it("returns RoleGrantDto fields and keeps a staff-path null granter", async () => {
    server.use(
      http.get(apiUrl(`/admin/users/${USER_ID}/roles`), () =>
        HttpResponse.json(envelope(`/admin/users/${USER_ID}/roles`, GRANTS)),
      ),
    );

    await expect(getMarketplaceUserRoles("ACCESS-TOKEN", USER_ID)).resolves.toEqual(GRANTS);
  });
});

describe("grant and revoke", () => {
  it("POSTs GrantRoleDto { role } and does not send a granter id", async () => {
    let method: string | null = null;
    let body: unknown = null;
    let authorization: string | null = null;

    server.use(
      http.post(apiUrl(`/admin/users/${USER_ID}/roles`), async ({ request }) => {
        method = request.method;
        authorization = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json(envelope(`/admin/users/${USER_ID}/roles`, GRANTS));
      }),
    );

    await expect(grantMarketplaceUserRole("ACCESS-TOKEN", USER_ID, "ROLE_ADMIN")).resolves.toEqual(
      GRANTS,
    );
    expect(method).toBe("POST");
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(body).toEqual({ role: "ROLE_ADMIN" });
    expect(body).not.toHaveProperty("grantedById");
  });

  it("DELETEs the role from the path and expects no data", async () => {
    let method: string | null = null;
    let pathname = "";

    server.use(
      http.delete(apiUrl(`/admin/users/${USER_ID}/roles/:role`), ({ request }) => {
        method = request.method;
        pathname = new URL(request.url).pathname;
        return HttpResponse.json({
          success: true,
          message: "Rol geri alındı.",
          httpStatus: "200 OK",
          path: pathname,
          requestId: "rid-revoke",
          timeStamp: "2026-09-11T14:00:00.000000000Z",
        });
      }),
    );

    await revokeMarketplaceUserRole("ACCESS-TOKEN", USER_ID, "ROLE_ADMIN");

    expect(method).toBe("DELETE");
    expect(pathname).toBe(`/admin/users/${USER_ID}/roles/ROLE_ADMIN`);
  });

  it("escapes the role name on revoke", async () => {
    expect(marketplaceUserRolesPath(USER_ID, "ROLE_ADMIN")).toBe(
      `/admin/users/${USER_ID}/roles/ROLE_ADMIN`,
    );
  });
});

describe("failures stay KoalaApiError", () => {
  it("surfaces a 409 without inventing a second rule", async () => {
    server.use(
      http.delete(apiUrl(`/admin/users/${USER_ID}/roles/ROLE_USER`), () =>
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

    try {
      await revokeMarketplaceUserRole("ACCESS-TOKEN", USER_ID, "ROLE_USER");
      throw new Error("expected refusal");
    } catch (error) {
      expect(isKoalaApiError(error)).toBe(true);
      if (isKoalaApiError(error)) {
        expect(error.status).toBe(409);
        expect(error.errorCode).toBe("ADMIN_USER_ROLE_MEMBERSHIP_PROTECTED");
      }
    }
  });
});
