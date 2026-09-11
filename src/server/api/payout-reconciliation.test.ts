import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { readPaging } from "./paging";
import {
  getPayouts,
  PAYOUT_PAGING,
  PAYOUTS_PATH,
  reconcilePayout,
  type PayoutSettlementEvidence,
} from "./payout-reconciliation";

const PAYOUT_ID = "9c000000-0000-4000-8000-000000000033";
const RECONCILE = apiUrl(`/admin/payouts/${PAYOUT_ID}/reconcile`);

const EVIDENCE: PayoutSettlementEvidence = {
  settlementReference: "TRF-2026-000033",
  providerReference: "iyz-transaction-000033",
  amount: "12345678901234567.89",
  currency: "TRY",
  settledAt: "2026-09-09T09:30:00Z",
};

const PAYOUT = {
  id: PAYOUT_ID,
  jobAssignmentId: "8c000000-0000-4000-8000-000000000034",
  amount: "12345678901234567.89",
  currency: "TRY",
  status: "COMPLETED",
  failureReason: null,
  completedAt: "2026-09-09T09:30:00Z",
  createdAt: "2026-09-01T08:00:00Z",
};

function success(data: unknown = PAYOUT): Response {
  return HttpResponse.json({
    success: true,
    message: "Hakediş banka mutabakatıyla tamamlandı.",
    httpStatus: "200 OK",
    path: `/admin/payouts/${PAYOUT_ID}/reconcile`,
    requestId: "rid-reconcile",
    timeStamp: "2026-09-09T09:31:00Z",
    data,
  });
}

describe("the staff payout queue", () => {
  it("omits status so the backend defaults to PROCESSING", async () => {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(PAYOUTS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json({
          success: true,
          message: "Hakedişler listelendi.",
          httpStatus: "200 OK",
          path: PAYOUTS_PATH,
          requestId: "rid-payouts",
          timeStamp: "2026-09-09T09:31:00Z",
          data: {
            content: [{ ...PAYOUT, status: "PROCESSING", completedAt: null }],
            page: 0,
            size: 20,
            totalElements: 1,
            totalPages: 1,
            first: true,
            last: true,
          },
        });
      }),
    );

    const page = await getPayouts("ACCESS-TOKEN", { paging: readPaging({}, PAYOUT_PAGING) });

    expect(seen.url?.searchParams.has("status")).toBe(false);
    expect(seen.url?.searchParams.get("page")).toBe("0");
    expect(seen.url?.searchParams.get("size")).toBe("20");
    expect(page.content[0]?.status).toBe("PROCESSING");
  });
});

describe("payout settlement reconciliation transport", () => {
  it("posts the exact evidence without converting or rounding the amount", async () => {
    let body: unknown = null;
    let authorization: string | null = null;
    server.use(
      http.post(RECONCILE, async ({ request }) => {
        body = await request.json();
        authorization = request.headers.get("authorization");
        return success();
      }),
    );

    const payout = await reconcilePayout("ACCESS-TOKEN", PAYOUT_ID, EVIDENCE);

    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(body).toEqual(EVIDENCE);
    expect(typeof (body as PayoutSettlementEvidence).amount).toBe("string");
    expect(payout).toEqual(PAYOUT);
    expect(typeof payout.amount).toBe("string");
  });

  it("escapes the payout id instead of allowing it to alter the endpoint", async () => {
    let url = "";
    server.use(
      http.post(apiUrl("/admin/payouts/*"), ({ request }) => {
        url = request.url;
        return success();
      }),
    );

    await reconcilePayout("ACCESS-TOKEN", "../../me", EVIDENCE);

    expect(url).toContain("%2F");
  });

  it("rejects a response that turns the payout amount into a number", async () => {
    server.use(http.post(RECONCILE, () => success({ ...PAYOUT, amount: 12.34 })));

    await expect(reconcilePayout("ACCESS-TOKEN", PAYOUT_ID, EVIDENCE)).rejects.toMatchObject({
      errorCode: "RESPONSE_SCHEMA_MISMATCH",
      requestId: "rid-reconcile",
    });
  });

  it("rejects a response whose completedAt is not an Instant", async () => {
    server.use(
      http.post(RECONCILE, () => success({ ...PAYOUT, completedAt: "2026-09-09T09:30:00" })),
    );

    await expect(reconcilePayout("ACCESS-TOKEN", PAYOUT_ID, EVIDENCE)).rejects.toMatchObject({
      errorCode: "RESPONSE_SCHEMA_MISMATCH",
      requestId: "rid-reconcile",
    });
  });

  it.each(["failureReason", "completedAt"] as const)(
    "rejects a response that omits required nullable %s",
    async (field) => {
      const incomplete = { ...PAYOUT };
      delete incomplete[field];
      server.use(http.post(RECONCILE, () => success(incomplete)));

      await expect(reconcilePayout("ACCESS-TOKEN", PAYOUT_ID, EVIDENCE)).rejects.toMatchObject({
        errorCode: "RESPONSE_SCHEMA_MISMATCH",
        requestId: "rid-reconcile",
      });
    },
  );

  it("preserves a backend mismatch message and request id", async () => {
    server.use(
      http.post(RECONCILE, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Ekstre tutarı hakediş tutarıyla eşleşmiyor.",
            httpStatus: "400 BAD_REQUEST",
            errorCode: "PAYOUT_SETTLEMENT_EVIDENCE_MISMATCH",
            errorCategory: "BUSINESS_RULE_VIOLATION",
            requestId: "rid-mismatch",
            path: `/admin/payouts/${PAYOUT_ID}/reconcile`,
            timeStamp: "2026-09-09T09:31:00Z",
          },
          { status: 400 },
        ),
      ),
    );

    await expect(reconcilePayout("ACCESS-TOKEN", PAYOUT_ID, EVIDENCE)).rejects.toMatchObject({
      status: 400,
      errorCode: "PAYOUT_SETTLEMENT_EVIDENCE_MISMATCH",
      message: "Ekstre tutarı hakediş tutarıyla eşleşmiyor.",
      requestId: "rid-mismatch",
    });
  });
});
