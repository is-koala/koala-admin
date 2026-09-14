import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminMeSuccessBody,
  resourceNotFoundBody,
  searchQueryTooLongBody,
} from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: AccountDeletionsPage } = await import("./page");
const { default: AccountDeletionDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const DELETIONS = apiUrl("/admin/account-deletions");

const READER = ["user.read_pii"];
const MANAGER = ["user.read_pii", "user.deletion.manage"];
const MODERATOR = ["content.moderate"];
const REQUEST_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const SUBJECT_ID = "bbbbbbbb-0000-4000-8000-000000000001";

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
  rejectionReason?: string | null;
  rejectedByStaffId?: string | null;
  blockers?: Array<{ type: string; id: string | null }> | null;
}

function row(overrides: Partial<DeletionRow> = {}): DeletionRow {
  return {
    id: REQUEST_ID,
    subjectId: SUBJECT_ID,
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

function watchDetail(data: DeletionRow = row(), respond?: () => Response) {
  const seen: { calls: number; requestId: string | null } = {
    calls: 0,
    requestId: null,
  };

  server.use(
    http.get(`${DELETIONS}/:requestId`, ({ params }) => {
      seen.calls += 1;
      seen.requestId = String(params.requestId);

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Hesap silme talebi getirildi.",
        httpStatus: "200 OK",
        path: `/admin/account-deletions/${REQUEST_ID}`,
        requestId: "rid-deletion-one",
        timeStamp: "2026-09-11T08:00:00.000000000Z",
        data,
      });
    }),
  );

  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(<AccountDeletionsPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

const renderDetail = async (id: string = REQUEST_ID, query: Record<string, string> = {}) =>
  (
    await renderServerComponent(
      <AccountDeletionDetailPage
        params={Promise.resolve({ id })}
        searchParams={Promise.resolve(query)}
      />,
    )
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
    expect(html).toContain(SUBJECT_ID);
    expect(html).not.toContain("ACCESS-TOKEN");
    expect(html).not.toContain("Talebi reddet");
  });

  it("refuses a MODERATOR on the object page and never asks GET by id", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const detail = watchDetail();

    const html = await renderDetail();

    expect(detail.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
  });
});

describe("the queue is not the review", () => {
  it("links each row to the object page and does not inline the reject form", async () => {
    stubMe(MANAGER);
    const detail = watchDetail();
    watchQueue([row()]);

    const html = await render({ durum: "REQUESTED", sayfa: "1", boyut: "40" });

    expect(detail.calls).toBe(0);
    expect(html).toContain(`/account-deletions/${REQUEST_ID}?`);
    expect(html).toContain("durum=REQUESTED");
    expect(html).toContain(`/users/${SUBJECT_ID}`);
    expect(html).toContain("İncele");
    expect(html).not.toContain("Talebi reddet");
    expect(html).not.toContain("Talep detayı");
  });
});

describe("reject stays gated on the object page", () => {
  it("shows the reject form only when user.deletion.manage is held", async () => {
    stubMe(MANAGER);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain("Talebi reddet");
    expect(html).toContain(`/users/${SUBJECT_ID}`);
  });

  it("tells a PII reader that listing is not enough to reject", async () => {
    stubMe(READER);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain("silme yönetimi yetkisi");
    expect(html).not.toContain("Talebi reddet");
  });
});

/** koala-admin#99: nesne sayfası denetim kaydına bu talep kimliğiyle bağlanır. */
describe("the audit pointer on the deletion page", () => {
  it("points at the audit log filtered to this request, only for an audit.read holder", async () => {
    stubMe(READER);
    watchDetail();
    const alone = await renderDetail();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...READER, "audit.read"]);
    watchDetail();
    const html = await renderDetail();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${REQUEST_ID}"`);
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

/** koala-admin#85: olmayan talep ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("a deletion request that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(READER);
    const detail = watchDetail(undefined, () =>
      HttpResponse.json(
        {
          ...resourceNotFoundBody,
          errorCode: "ACCOUNT_DELETION_REQUEST_NOT_FOUND",
          path: `/admin/account-deletions/${REQUEST_ID}`,
        },
        { status: 404 },
      ),
    );

    const thrown = await renderDetail().then(
      () => null,
      (error: unknown) => error,
    );

    expect(detail.calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(READER);
    const detail = watchDetail();

    const thrown = await renderDetail("not-a-uuid").then(
      () => null,
      (error: unknown) => error,
    );

    expect(detail.calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

describe("the search box — koala-admin#94", () => {
  it("sends ara to the backend as query, next to the status, and names it in the result line", async () => {
    stubMe(READER);
    const queue = watchQueue([row()]);

    const html = await render({ ara: " ayse@example.com ", durum: "REQUESTED" });

    expect(queue.url?.searchParams.get("query")).toBe("ayse@example.com");
    expect(queue.url?.searchParams.get("status")).toBe("REQUESTED");
    expect(html).toContain("“ayse@example.com” için 1 talep bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("offers Temizle, which drops ara and keeps the view", async () => {
    stubMe(READER);
    watchQueue([row()]);

    const html = await render({ ara: "ayse@example.com", durum: "REJECTED" });

    expect(html).toContain(
      'href="/account-deletions?durum=REJECTED&amp;sirala=requestedAt%2Cdesc&amp;boyut=20"',
    );
    expect(html).toContain("Temizle");
  });

  it("says there is no result for the query", async () => {
    stubMe(READER);
    watchQueue([]);

    const html = await render({ ara: "kimse@example.com" });

    expect(html).toContain("“kimse@example.com” için sonuç yok.");
    expect(html).not.toContain("Hesap silme talebi yok.");
  });

  it("shows the backend's 400 for an over-long query inline", async () => {
    stubMe(READER);
    server.use(
      http.get(DELETIONS, () =>
        HttpResponse.json(searchQueryTooLongBody("/admin/account-deletions"), { status: 400 }),
      ),
    );

    const html = await render({ ara: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Hesap silme kuyruğu yüklenemedi.");
  });
});

/** koala-admin#100 / koala-backend#283: ret gerekçesi, reddeden personel ve canlı engelleyiciler. */
describe("rejection provenance and the live blockers", () => {
  const PAYMENT = "7b000000-0000-4000-8000-000000000071";
  const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";
  const DISPUTE = "6d000000-0000-4000-8000-000000000061";

  const blocked = () =>
    row({
      blockers: [
        { type: "PENDING_PAYMENT", id: PAYMENT },
        { type: "ESCROW", id: ASSIGNMENT },
        { type: "DISPUTE", id: DISPUTE },
        { type: "FUTURE_BLOCKER", id: null },
      ],
    });

  it("draws the rejection reason and the rejecting staff id on a rejected request", async () => {
    stubMe(READER);
    watchDetail(
      row({
        status: "REJECTED",
        processedAt: "2026-09-11T09:00:00Z",
        rejectionReason: "Açık hakediş var.",
        rejectedByStaffId: "5f000000-0000-4000-8000-000000000055",
      }),
    );

    const html = await renderDetail();

    expect(html).toContain('data-testid="deletion-rejection-reason"');
    expect(html).toContain("Açık hakediş var.");
    // staff.read yok: kısa kimlik, tam kimlik title'da, bağlantısız (koala-admin#112).
    expect(html).toMatch(
      /Reddeden personel<\/dt><dd[^>]*><span[^>]*title="5f000000-0000-4000-8000-000000000055">5f000000</,
    );
    expect(html).not.toContain("#personel-");
  });

  it("writes the empty value for a rejected request from a #265 server and omits the rows while pending", async () => {
    stubMe(READER);
    watchDetail(row({ status: "REJECTED", processedAt: "2026-09-11T09:00:00Z" }));
    const legacy = await renderDetail();
    expect(legacy).toMatch(/Ret gerekçesi<\/dt><dd[^>]*>—</);
    expect(legacy).toMatch(/Reddeden personel<\/dt><dd[^>]*>—</);
    expect(legacy).not.toContain('data-testid="deletion-blockers"');

    stubMe(READER);
    watchDetail(row());
    const pending = await renderDetail();
    expect(pending).not.toContain('data-testid="deletion-rejection-reason"');
    expect(pending).not.toContain('data-testid="deletion-blockers"');
  });

  it("names each blocker and links it only when the target page's permission is held", async () => {
    stubMe(READER);
    watchDetail(blocked());
    const alone = await renderDetail();
    expect(alone).toContain('data-testid="deletion-blockers"');
    expect(alone).toContain("Bekleyen tahsilat");
    expect(alone).toContain("Emanette para");
    expect(alone).toContain("Açık uyuşmazlık");
    expect(alone).toContain("FUTURE_BLOCKER");
    expect(alone).toContain(PAYMENT);
    expect(alone).not.toContain(`href="/payments/${PAYMENT}"`);
    expect(alone).not.toContain(`href="/assignments/${ASSIGNMENT}"`);
    expect(alone).not.toContain(`href="/disputes/${DISPUTE}"`);

    stubMe([...READER, "payment.read", "dispute.resolve"]);
    watchDetail(blocked());
    const linked = await renderDetail();
    expect(linked).toContain(`href="/payments/${PAYMENT}"`);
    expect(linked).toContain(`href="/assignments/${ASSIGNMENT}"`);
    expect(linked).toContain(`href="/disputes/${DISPUTE}"`);
  });

  it("says when the server computed no blocker", async () => {
    stubMe(READER);
    watchDetail(row({ blockers: [] }));
    const html = await renderDetail();
    expect(html).toContain("Engelleyici yok");
  });
});

/** koala-admin#112: kırıntı menüdeki adla, kuyruk görünümü geri taşınır. */
describe("the deletion request's breadcrumb", () => {
  it("writes Hesap silme › short id and links the queue with the carried view", async () => {
    stubMe(READER);
    watchDetail();

    const html = await renderDetail(REQUEST_ID, { durum: "REJECTED", sirala: "requestedAt,desc" });

    expect(html).toContain('<nav aria-label="Konum">');
    expect(html).toContain(
      'href="/account-deletions?durum=REJECTED&amp;sirala=requestedAt%2Cdesc"><span class="">Hesap silme</span></a>',
    );
    expect(html).toContain(`title="${REQUEST_ID}">${REQUEST_ID.slice(0, 8)}<`);
    expect(html).not.toContain("Kuyruğa dön");
  });
});
