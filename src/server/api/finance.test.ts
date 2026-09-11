import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { getFinanceSummary } from "./finance";

const SUMMARY = apiUrl("/admin/finance/summary");

const DATA = {
  from: "1970-01-01T00:00:00Z",
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

function success(data: unknown = DATA): Response {
  return HttpResponse.json({
    success: true,
    message: "Finans özeti getirildi.",
    httpStatus: "200 OK",
    path: "/admin/finance/summary",
    requestId: "rid-finance",
    timeStamp: "2026-09-11T17:00:00.000000000Z",
    data,
  });
}

describe("finance summary transport", () => {
  it("GETs /admin/finance/summary and keeps money as decimal text", async () => {
    let authorization: string | null = null;
    let href = "";
    server.use(
      http.get(SUMMARY, ({ request }) => {
        authorization = request.headers.get("authorization");
        href = request.url;
        return success();
      }),
    );

    const summary = await getFinanceSummary("ACCESS-TOKEN", {
      from: "2026-02-28T21:00:00.000Z",
      to: "2026-03-31T21:00:00.000Z",
    });

    const url = new URL(href);
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(url.searchParams.get("from")).toBe("2026-02-28T21:00:00.000Z");
    expect(url.searchParams.get("to")).toBe("2026-03-31T21:00:00.000Z");
    expect(url.searchParams.has("currency")).toBe(false);
    expect(summary.employerVolume).toBe("1075.00");
    expect(typeof summary.koalaFee).toBe("string");
    expect(summary.awaitingPayoutCount).toBe(1);
  });

  it("rejects a response that turns volume into a number", async () => {
    server.use(http.get(SUMMARY, () => success({ ...DATA, employerVolume: 1075 })));

    await expect(getFinanceSummary("ACCESS-TOKEN")).rejects.toMatchObject({
      errorCode: "RESPONSE_SCHEMA_MISMATCH",
    });
  });
});
