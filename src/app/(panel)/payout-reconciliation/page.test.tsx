import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
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
