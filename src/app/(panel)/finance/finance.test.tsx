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

const { default: FinancePage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const SUMMARY = apiUrl("/admin/finance/summary");

const ANALYST = ["finance.read"];
const HANDLER = ["dispute.resolve"];

const DATA = {
  from: "2026-02-28T21:00:00Z",
  to: "2026-03-31T21:00:00Z",
  currency: "TRY",
  employerVolume: "1075.00",
  koalaFee: "75.00",
  workerPayout: "1000.00",
  succeededPaymentCount: 1,
  completedPayoutAmount: "1000.00",
  completedPayoutCount: 1,
  awaitingPayoutAmount: "400.00",
  awaitingPayoutCount: 1,
};

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["FINANCE_ANALYST"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watchSummary(data: unknown = DATA) {
  const seen: { calls: number; authorization: string | null; url: URL | null } = {
    calls: 0,
    authorization: null,
    url: null,
  };

  server.use(
    http.get(SUMMARY, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      seen.url = new URL(request.url);
      return HttpResponse.json({
        success: true,
        message: "Finans özeti getirildi.",
        httpStatus: "200 OK",
        path: "/admin/finance/summary",
        requestId: "rid-finance",
        timeStamp: "2026-09-11T17:00:00.000000000Z",
        data,
      });
    }),
  );

  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (await renderServerComponent(<FinancePage searchParams={Promise.resolve(params)} />)).replaceAll(
    "<!-- -->",
    "",
  );

describe("who can read the finance summary", () => {
  it("refuses a DISPUTE_HANDLER without finance.read and never asks the backend", async () => {
    stubMe(HANDLER, ["DISPUTE_HANDLER"]);
    const summary = watchSummary();

    const html = await render();

    expect(summary.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Finans raporlarını görüntüle");
    expect(html).not.toContain("₺1.075,00");
  });

  it("lets finance.read through and keeps the bearer token on the server", async () => {
    stubMe(ANALYST);
    const summary = watchSummary();

    const html = await render();

    expect(summary.calls).toBe(1);
    expect(summary.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).toContain("₺1.075,00");
    expect(html).toContain("₺75,00");
    expect(html).toContain("₺1.000,00");
    expect(html).toContain("₺400,00");
    expect(html).not.toContain("ACCESS-TOKEN");
  });
});

describe("period filters go to the backend, not over the page", () => {
  it("sends an Istanbul day range as Instant from/to", async () => {
    stubMe(ANALYST);
    const summary = watchSummary();

    await render({ from: "2026-03-01", to: "2026-03-31" });

    expect(summary.calls).toBe(1);
    expect(summary.url?.searchParams.get("from")).toBe("2026-02-28T21:00:00.000Z");
    expect(summary.url?.searchParams.get("to")).toBe("2026-03-31T21:00:00.000Z");
  });

  it("does not call the backend for a one-sided period", async () => {
    stubMe(ANALYST);
    const summary = watchSummary();

    const html = await render({ from: "2026-03-01" });

    expect(summary.calls).toBe(0);
    expect(html).toContain("Dönem geçersiz.");
  });
});
