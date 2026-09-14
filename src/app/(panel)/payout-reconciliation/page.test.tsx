import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody, searchQueryTooLongBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: PayoutReconciliationPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const PAYOUTS = apiUrl("/admin/payouts");
const OFFICER = ["payout.reconcile"];
const ANALYST = ["finance.read"];

const PAYOUT_ID = "9c000000-0000-4000-8000-000000000033";
const ASSIGNMENT_ID = "8c000000-0000-4000-8000-000000000034";

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["FINANCE_OFFICER"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watchQueue(rows: unknown[] = []) {
  const seen: { calls: number; url: URL | null } = { calls: 0, url: null };
  server.use(
    http.get(PAYOUTS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      return HttpResponse.json({
        success: true,
        message: "Hakedişler listelendi.",
        httpStatus: "200 OK",
        path: "/admin/payouts",
        requestId: "rid-payouts",
        timeStamp: "2026-09-12T00:00:00.000000000Z",
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
    await renderServerComponent(<PayoutReconciliationPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

describe("who can see the payout queue", () => {
  it("refuses a finance.read holder and never asks GET /admin/payouts", async () => {
    stubMe(ANALYST, ["FINANCE_ANALYST"]);
    const queue = watchQueue([
      {
        id: PAYOUT_ID,
        jobAssignmentId: ASSIGNMENT_ID,
        amount: "1000.00",
        currency: "TRY",
        status: "PROCESSING",
        failureReason: null,
        completedAt: null,
        createdAt: "2026-09-01T08:00:00Z",
      },
    ]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Hakedişi banka ekstresiyle mutabık kıl");
    expect(html).not.toContain(PAYOUT_ID);
  });

  it("lists PROCESSING payouts and prefills confirm from the row", async () => {
    stubMe(OFFICER);
    const queue = watchQueue([
      {
        id: PAYOUT_ID,
        jobAssignmentId: ASSIGNMENT_ID,
        amount: "1000.00",
        currency: "TRY",
        status: "PROCESSING",
        failureReason: null,
        completedAt: null,
        createdAt: "2026-09-01T08:00:00Z",
      },
    ]);

    const html = await render({ hakedis: PAYOUT_ID });

    expect(queue.calls).toBe(1);
    expect(queue.url?.searchParams.has("status")).toBe(false);
    expect(html).toContain("Bekleyen hakedişler");
    expect(html).toContain(ASSIGNMENT_ID);
    expect(html).toContain('value="' + PAYOUT_ID + '"');
    expect(html).toContain("Seçili");
  });
});

const PROCESSING_ROW = {
  id: PAYOUT_ID,
  jobAssignmentId: ASSIGNMENT_ID,
  amount: "1000.00",
  currency: "TRY",
  status: "PROCESSING",
  failureReason: null,
  completedAt: null,
  createdAt: "2026-09-01T08:00:00Z",
};

describe("the search box — koala-admin#94", () => {
  it("sends ara to the backend as query, still without status, and names it in the result line", async () => {
    stubMe(OFFICER);
    const queue = watchQueue([PROCESSING_ROW]);

    const html = await render({ ara: " ayşe " });

    expect(queue.url?.searchParams.get("query")).toBe("ayşe");
    expect(queue.url?.searchParams.has("status")).toBe(false);
    expect(html).toContain("“ayşe” için 1 hakediş bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("offers Temizle, which drops ara and keeps the selected payout", async () => {
    stubMe(OFFICER);
    watchQueue([PROCESSING_ROW]);

    const html = await render({ ara: "ayşe", hakedis: PAYOUT_ID });

    expect(html).toContain(`href="/payout-reconciliation?boyut=20&amp;hakedis=${PAYOUT_ID}"`);
    expect(html).toContain("Temizle");
  });

  it("says there is no result for the query", async () => {
    stubMe(OFFICER);
    watchQueue([]);

    const html = await render({ ara: "kimse" });

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html).not.toContain("Bekleyen hakediş yok.");
  });

  it("shows the backend's 400 for an over-long query inline and keeps the confirm form", async () => {
    stubMe(OFFICER);
    server.use(
      http.get(PAYOUTS, () =>
        HttpResponse.json(searchQueryTooLongBody("/admin/payouts"), { status: 400 }),
      ),
    );

    const html = await render({ ara: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).toContain("Ekstre onayı");
    expect(html).not.toContain("Bekleyen hakedişler yüklenemedi.");
  });
});

/** koala-admin#100: `?isci=` backend'in `workerId` süzgecine gider (koala-backend#283). */
describe("the worker filter — koala-admin#100", () => {
  const WORKER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

  it("sends isci as workerId, still without status, and offers to drop the filter", async () => {
    stubMe(OFFICER);
    const queue = watchQueue([]);

    const html = await render({ isci: WORKER_ID, boyut: "10" });

    expect(queue.url?.searchParams.get("workerId")).toBe(WORKER_ID);
    expect(queue.url?.searchParams.get("status")).toBeNull();
    expect(html).toContain('data-testid="payout-worker-filter"');
    expect(html).toContain(WORKER_ID);
    expect(html).toContain('href="/payout-reconciliation?boyut=10"');
  });

  it("sends all four statuses for durum=hepsi so the count on the user page matches the list", async () => {
    stubMe(OFFICER);
    const queue = watchQueue([]);

    const html = await render({ isci: WORKER_ID, durum: "hepsi" });

    expect(queue.url?.searchParams.get("status")).toBe("PENDING,PROCESSING,COMPLETED,FAILED");
    expect(queue.url?.searchParams.get("workerId")).toBe(WORKER_ID);
    expect(html).toContain("tüm durumlardaki hakedişleri");
  });

  it("badges each row from its own status and offers Onayla only on PROCESSING", async () => {
    stubMe(OFFICER);
    const recipient = {
      id: WORKER_ID,
      firstName: "Ayşe",
      lastName: "Yılmaz",
      username: "ayse",
      profilePictureUrl: null,
    };
    const COMPLETED_ID = "9c000000-0000-4000-8000-000000000041";
    const PENDING_ID = "9c000000-0000-4000-8000-000000000042";
    watchQueue([
      {
        ...PROCESSING_ROW,
        id: COMPLETED_ID,
        status: "COMPLETED",
        completedAt: "2026-09-02T08:00:00Z",
        recipient,
      },
      { ...PROCESSING_ROW, id: PENDING_ID, status: "PENDING", recipient },
      { ...PROCESSING_ROW, recipient },
    ]);

    const html = await render({ isci: WORKER_ID, durum: "hepsi" });

    expect(html).toContain("Tamamlandı");
    expect(html).toContain("Bekliyor");
    expect(html).toContain("İşleniyor");
    expect(html).toContain(`href="/users/${WORKER_ID}"`);
    expect(html).toContain("Ayşe Yılmaz");

    const onayla = html.match(/hakedis=([0-9a-f-]{36})[^>]*>Onayla</g) ?? [];
    expect(onayla).toHaveLength(1);
    expect(onayla[0]).toContain(`hakedis=${PAYOUT_ID}`);
    expect(html).not.toContain(`hakedis=${COMPLETED_ID}`);
    expect(html).not.toContain(`hakedis=${PENDING_ID}`);
  });

  it("writes — for the worker when an older backend sends no recipient", async () => {
    stubMe(OFFICER);
    watchQueue([PROCESSING_ROW]);

    const html = await render();

    expect(html).toContain("İşçi");
    // Tarih hücresinden sonraki İşçi hücresi "—", ardından tutar gelir.
    expect(html).toMatch(/<\/a><\/td><td[^>]*>—<\/td><td[^>]*>₺1\.000,00/);
    expect(html).toContain("İşleniyor");
    expect(html).toContain("Onayla");
    expect(html).not.toContain('href="/users/');
  });

  it("drops a worker id that is not a UUID before it reaches the backend", async () => {
    stubMe(OFFICER);
    const queue = watchQueue([]);

    const html = await render({ isci: "not-a-uuid" });

    expect(queue.url?.searchParams.has("workerId")).toBe(false);
    expect(html).not.toContain('data-testid="payout-worker-filter"');
  });
});
