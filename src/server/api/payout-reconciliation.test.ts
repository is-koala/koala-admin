import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  ADMIN_PAYOUTS_PATH,
  PAYOUT_QUEUE_PAGING,
  getAdminPayouts,
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

const PROCESSING = {
  ...PAYOUT,
  status: "PROCESSING" as const,
  completedAt: null,
};

function pageSuccess(content: unknown[] = [PROCESSING]): Response {
  return HttpResponse.json({
    success: true,
    message: "Hakedişler listelendi.",
    httpStatus: "200 OK",
    path: ADMIN_PAYOUTS_PATH,
    requestId: "rid-payout-list",
    timeStamp: "2026-09-12T00:00:00Z",
    data: {
      content,
      page: 0,
      size: 20,
      totalElements: content.length,
      totalPages: 1,
      first: true,
      last: true,
    },
  });
}

describe("the pending payout settlement queue", () => {
  it("pages /admin/payouts without a status so the backend keeps PROCESSING-only", async () => {
    let url: URL | null = null;
    server.use(
      http.get(apiUrl(ADMIN_PAYOUTS_PATH), ({ request }) => {
        url = new URL(request.url);
        return pageSuccess();
      }),
    );

    const page = await getAdminPayouts("ACCESS-TOKEN", {
      page: 0,
      size: 20,
      sort: PAYOUT_QUEUE_PAGING.defaultSort,
    });

    expect(url).not.toBeNull();
    const params = url as unknown as URL;
    expect(params.searchParams.get("status")).toBeNull();
    expect(params.searchParams.get("sort")).toBe("createdAt,desc");
    expect(page.content[0]?.id).toBe(PAYOUT_ID);
    expect(page.content[0]?.status).toBe("PROCESSING");
    expect(typeof page.content[0]?.amount).toBe("string");
  });

  it("rejects a queue row that turns the payout amount into a number", async () => {
    server.use(
      http.get(apiUrl(ADMIN_PAYOUTS_PATH), () => pageSuccess([{ ...PROCESSING, amount: 12.34 }])),
    );

    await expect(
      getAdminPayouts("ACCESS-TOKEN", {
        page: 0,
        size: 20,
        sort: PAYOUT_QUEUE_PAGING.defaultSort,
      }),
    ).rejects.toMatchObject({
      errorCode: "RESPONSE_SCHEMA_MISMATCH",
      requestId: "rid-payout-list",
    });
  });
});
