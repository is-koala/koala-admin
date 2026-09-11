import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: AccountDeletionsPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const DELETIONS = apiUrl("/admin/account-deletions");

const READER = ["user.read_pii"];
const MANAGER = ["user.read_pii", "user.deletion.manage"];
const MODERATOR = ["content.moderate"];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["AUDITOR"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

interface DeletionRow {
  id: string;
  subjectId: string | null;
  status: string;
  requestedAt: string | null;
  processedAt: string | null;
  blockedReason: string | null;
}

function row(overrides: Partial<DeletionRow> = {}): DeletionRow {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    subjectId: "bbbbbbbb-0000-4000-8000-000000000001",
    status: "REQUESTED",
    requestedAt: "2026-09-10T08:00:00Z",
    processedAt: null,
    blockedReason: null,
    ...overrides,
  };
}

function watchQueue(rows: DeletionRow[]) {
  const seen: { calls: number; url: URL | null; authorization: string | null } = {
    calls: 0,
    url: null,
    authorization: null,
  };

  server.use(
    http.get(DELETIONS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "Hesap silme talepleri listelendi.",
        httpStatus: "200 OK",
        path: "/admin/account-deletions",
        requestId: "rid-deletions",
        timeStamp: "2026-09-11T08:00:00.000000000Z",
        data: {
          content: rows,
          page: 0,
          size: 20,
          totalElements: rows.length,
          totalPages: rows.length === 0 ? 0 : 1,
          first: true,
          last: true,
        },
      });
    }),
  );

  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(<AccountDeletionsPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

describe("who can see the queue", () => {
  it("refuses a MODERATOR and never asks the backend for deletions", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain("aaaaaaaa");
  });

  it("lets user.read_pii through and keeps the bearer token on the server", async () => {
    stubMe(READER);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(queue.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).toContain("bbbbbbbb-0000-4000-8000-000000000001");
    expect(html).not.toContain("ACCESS-TOKEN");
    expect(html).toContain("user.deletion.manage");
  });

  it("shows the reject form only when user.deletion.manage is held", async () => {
    stubMe(MANAGER);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Talebi reddet");
  });
});

describe("status and paging are backend query parameters", () => {
  it("omits status when the filter is all", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    await render();

    expect(queue.url?.searchParams.has("status")).toBe(false);
    expect(queue.url?.searchParams.get("page")).toBe("0");
    expect(queue.url?.searchParams.get("size")).toBe("20");
    expect(queue.url?.searchParams.get("sort")).toBe("requestedAt,desc");
  });

  it("sends REQUESTED with the requested page and sort", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    await render({ durum: "REQUESTED", sayfa: "1", boyut: "40", sirala: "status,asc" });

    expect(queue.url?.searchParams.get("status")).toBe("REQUESTED");
    expect(queue.url?.searchParams.get("page")).toBe("1");
    expect(queue.url?.searchParams.get("size")).toBe("40");
    expect(queue.url?.searchParams.get("sort")).toBe("status,asc");
  });

  it("falls back to all for a status Spring would reject", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    await render({ durum: "MAYBE" });

    expect(queue.url?.searchParams.has("status")).toBe(false);
  });
});
