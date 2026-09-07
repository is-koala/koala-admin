import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeNoStaffRecordBody, adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { withReactCacheScope } from "../../../test/react-cache-scope";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { StaffAuthError } = await import("@/server/auth/errors");
const { getStaffContext, loadStaffContext } = await import("./staff-context");

const ADMIN_ME = apiUrl("/admin/me");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  // Failures are logged by the API client; the assertions are about the return
  // value, not the noise.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

/** `GET /admin/me` answering 200 with the given permission names. */
function stubMe(permissions: readonly string[], roles: readonly string[] = ["TRUST_LEAD"]) {
  let calls = 0;
  let authorization: string | null = null;

  server.use(
    http.get(ADMIN_ME, ({ request }) => {
      calls += 1;
      authorization = request.headers.get("authorization");
      return HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      });
    }),
  );

  return {
    get calls() {
      return calls;
    },
    get authorization() {
      return authorization;
    },
  };
}

describe("resolving permissions from the backend", () => {
  it("asks GET /admin/me with the access token and returns what it says", async () => {
    const me = stubMe(["content.moderate", "dispute.resolve", "user.read", "user.read_pii"]);

    const context = await loadStaffContext();

    expect(me.calls).toBe(1);
    expect(me.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(context.failure).toBeNull();
    expect(context.permissions).toEqual([
      "content.moderate",
      "dispute.resolve",
      "user.read",
      "user.read_pii",
    ]);
    expect(context.has("dispute.resolve")).toBe(true);
    expect(context.has("payout.release")).toBe(false);
  });

  it("keeps roles as evidence and never turns them into permissions", async () => {
    // The backend resolves the role→permission DAG. A panel that inferred
    // `category.manage` from `CATALOG_EDITOR` would put ADR-0010's staleness
    // back, so a role with no permissions attached grants nothing.
    stubMe([], ["OWNER", "CATALOG_EDITOR", "FINANCE_OFFICER"]);

    const context = await loadStaffContext();

    expect(context.staff?.roles).toEqual(["OWNER", "CATALOG_EDITOR", "FINANCE_OFFICER"]);
    expect(context.permissions).toEqual([]);
    expect(context.has("category.manage")).toBe(false);
    expect(context.has("payout.release")).toBe(false);
  });

  it("ignores a permission name this panel version has never heard of", async () => {
    // A backend that ships a seventeenth permission must not empty every
    // operator's menu. Unknown names gate nothing, so dropping them denies
    // nothing that used to be allowed — but they are recorded, not swallowed.
    stubMe(["category.manage", "warp.drive"]);

    const context = await loadStaffContext();

    expect(context.permissions).toEqual(["category.manage"]);
    expect(context.staff?.unknownPermissions).toEqual(["warp.drive"]);
    expect(context.failure).toBeNull();
  });

  it("never sends the request without a token", async () => {
    getKoalaAccessToken.mockRejectedValue(
      new StaffAuthError("SESSION_REQUIRED", "Oturum çerezi yok."),
    );
    // No handler is registered for /admin/me; MSW's `onUnhandledRequest:
    // "error"` turns a request into a failure, which is the assertion.

    const context = await loadStaffContext();

    expect(context.failure).toMatchObject({ kind: "SESSION", authCode: "SESSION_REQUIRED" });
    expect(context.permissions).toEqual([]);
  });
});

describe("failing closed", () => {
  it("empties the permission list when /admin/me answers 500", async () => {
    server.use(
      http.get(ADMIN_ME, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/me",
            timeStamp: "2026-09-06T09:13:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );

    const context = await loadStaffContext();

    // Not "they probably had category.manage a minute ago".
    expect(context.permissions).toEqual([]);
    expect(context.staff).toBeNull();
    expect(context.failure).toMatchObject({
      kind: "BACKEND_UNAVAILABLE",
      status: 500,
      requestId: "rid-500",
    });
    for (const permission of ["category.manage", "audit.read", "payout.release"] as const) {
      expect(context.has(permission)).toBe(false);
    }
  });

  it("tells a valid token with no staff record apart from a broken backend", async () => {
    server.use(
      http.get(ADMIN_ME, () => HttpResponse.json(adminMeNoStaffRecordBody, { status: 403 })),
    );

    const context = await loadStaffContext();

    expect(context.failure).toMatchObject({
      kind: "NO_STAFF_RECORD",
      status: 403,
      requestId: "3f5a1c88-91f0-4c5b-9c02-5b6a1f0d9e77",
    });
    expect(context.permissions).toEqual([]);
  });

  it("empties the permission list when the backend cannot be reached at all", async () => {
    server.use(http.get(ADMIN_ME, () => HttpResponse.error()));

    const context = await loadStaffContext();

    expect(context.failure?.kind).toBe("BACKEND_UNAVAILABLE");
    expect(context.permissions).toEqual([]);
  });

  it("empties the permission list when the response does not match the contract", async () => {
    // A `permissions` field that arrived as a string rather than an array is
    // not a reason to guess; it is a reason to grant nothing.
    server.use(
      http.get(ADMIN_ME, () =>
        HttpResponse.json({
          ...adminMeSuccessBody,
          data: { ...adminMeSuccessBody.data, permissions: "category.manage" },
        }),
      ),
    );

    const context = await loadStaffContext();

    expect(context.failure?.kind).toBe("BACKEND_UNAVAILABLE");
    expect(context.permissions).toEqual([]);
  });

  it("routes a session failure to the code the existing error page already explains", async () => {
    for (const code of ["SESSION_EXPIRED", "PASSWORD_CHANGE_REQUIRED", "BACKEND_UNREACHABLE"]) {
      getKoalaAccessToken.mockRejectedValueOnce(new StaffAuthError(code as "SESSION_EXPIRED"));

      const context = await loadStaffContext();

      expect(context.failure).toMatchObject({ kind: "SESSION", authCode: code });
      expect(context.permissions).toEqual([]);
    }
  });

  it("treats an unrecognised throw as a denial rather than letting it escape", async () => {
    getKoalaAccessToken.mockRejectedValue(new TypeError("boom"));

    const context = await loadStaffContext();

    expect(context.failure).toMatchObject({ kind: "UNEXPECTED", detail: "boom" });
    expect(context.permissions).toEqual([]);
  });
});

describe("de-duplication", () => {
  it("calls /admin/me once per render however many callers ask", async () => {
    // The menu in the layout and the gate on the page both ask. One request.
    const me = stubMe(["category.manage"]);

    const contexts = await withReactCacheScope(async () => {
      const first = await getStaffContext();
      const second = await getStaffContext();
      const third = await getStaffContext();
      return [first, second, third];
    });

    expect(me.calls).toBe(1);
    expect(contexts[1]).toBe(contexts[0]);
    expect(contexts[2]).toBe(contexts[0]);
  });

  it("does not carry the answer over to the next render", async () => {
    // This is the property ADR-0010 turns on: a permission revoked between two
    // page views must be gone on the second one. A memo that outlived the
    // request — a cookie, a JWT field, `unstable_cache` — would fail here.
    const first = stubMe(["category.manage", "payout.release"]);

    const before = await withReactCacheScope(() => getStaffContext());
    expect(before.has("payout.release")).toBe(true);
    expect(first.calls).toBe(1);

    server.resetHandlers();
    const second = stubMe(["category.manage"]);

    const after = await withReactCacheScope(() => getStaffContext());

    expect(second.calls).toBe(1);
    expect(after.has("payout.release")).toBe(false);
    expect(after.has("category.manage")).toBe(true);
  });
});
