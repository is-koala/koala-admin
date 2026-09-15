import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { readPaging } from "./paging";
import {
  getPayoutDetail,
  getPayouts,
  PAYOUT_PAGING,
  PAYOUTS_PATH,
  payoutPath,
  reconcilePayout,
  type PayoutSettlementEvidence,
} from "./payout-reconciliation";
import { adminPayoutDetailFixture } from "../../../test/fixtures/admin-detail";

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
  recipient: null,
  maskedIban: null,
  providerReference: null,
  amount: "12345678901234567.89",
  currency: "TRY",
  status: "COMPLETED",
  failureReason: null,
  processingAt: null,
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

  /** koala-admin#106: `StaffPayoutDto.recipient`; eski sunucu/silinmiş kullanıcı → null. */
  it("reads the statement-matching evidence carried by the staff payout row", async () => {
    const withRecipient = {
      ...PAYOUT,
      maskedIban: "TR18***2315",
      providerReference: "iyz-transaction-000033",
      processingAt: "2026-09-01T08:05:00Z",
      recipient: {
        id: "aaaaaaaa-0000-4000-8000-000000000001",
        firstName: "Ayşe",
        lastName: "Yılmaz",
        username: "ayse",
        profilePictureUrl: null,
      },
    };
    const { recipient: _dropped, ...withoutRecipient } = PAYOUT;
    server.use(
      http.get(apiUrl(PAYOUTS_PATH), () =>
        HttpResponse.json({
          success: true,
          message: "Hakedişler listelendi.",
          httpStatus: "200 OK",
          path: PAYOUTS_PATH,
          requestId: "rid-payouts",
          timeStamp: "2026-09-09T09:31:00Z",
          data: {
            content: [withRecipient, withoutRecipient],
            page: 0,
            size: 20,
            totalElements: 2,
            totalPages: 1,
            first: true,
            last: true,
          },
        }),
      ),
    );

    const page = await getPayouts("ACCESS-TOKEN", { paging: readPaging({}, PAYOUT_PAGING) });

    expect(page.content[0]?.recipient?.firstName).toBe("Ayşe");
    expect(page.content[0]?.maskedIban).toBe("TR18***2315");
    expect(page.content[0]?.providerReference).toBe("iyz-transaction-000033");
    expect(page.content[0]?.processingAt).toBe("2026-09-01T08:05:00Z");
    expect(page.content[1]?.recipient).toBeNull();
  });

  it("rejects a staff row that exposes an unmasked destination IBAN", async () => {
    server.use(
      http.get(apiUrl(PAYOUTS_PATH), () =>
        HttpResponse.json({
          success: true,
          message: "Hakedişler listelendi.",
          httpStatus: "200 OK",
          path: PAYOUTS_PATH,
          requestId: "rid-payouts",
          timeStamp: "2026-09-09T09:31:00Z",
          data: {
            content: [
              {
                ...PAYOUT,
                status: "PROCESSING",
                completedAt: null,
                maskedIban: "TR180006200119000006672315",
              },
            ],
            page: 0,
            size: 20,
            totalElements: 1,
            totalPages: 1,
            first: true,
            last: true,
          },
        }),
      ),
    );

    await expect(
      getPayouts("ACCESS-TOKEN", { paging: readPaging({}, PAYOUT_PAGING) }),
    ).rejects.toMatchObject({
      errorCode: "RESPONSE_SCHEMA_MISMATCH",
      requestId: "rid-payouts",
    });
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

function searchEnvelope(path: string) {
  return {
    success: true,
    message: "Listelendi.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-search",
    timeStamp: "2026-09-14T08:00:00Z",
    data: {
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
    },
  };
}

/**
 * koala-backend#263: `query` 2–100 karakter, kırpılmış; kısa değer süzmez.
 * Kuralın kendisi `search-query.test.ts`'de; burada yalnız bu kurucunun ona
 * uyduğu ve parametreyi backend'in beklediği adla gönderdiği sabitlenir.
 */
describe("the payout queue search goes to the backend as query", () => {
  function watchSearch() {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(PAYOUTS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(searchEnvelope(PAYOUTS_PATH));
      }),
    );
    return seen;
  }

  it("forwards a trimmed search as query", async () => {
    const seen = watchSearch();

    await getPayouts("ACCESS-TOKEN", {
      paging: readPaging({}, PAYOUT_PAGING),
      query: "  Ayşe Yılmaz  ",
    });

    expect(seen.url?.searchParams.get("query")).toBe("Ayşe Yılmaz");
  });

  it("sends no query for one character, and clips at 100", async () => {
    const seen = watchSearch();

    await getPayouts("ACCESS-TOKEN", { paging: readPaging({}, PAYOUT_PAGING), query: "a" });
    expect(seen.url?.searchParams.has("query")).toBe(false);

    await getPayouts("ACCESS-TOKEN", {
      paging: readPaging({}, PAYOUT_PAGING),
      query: "k".repeat(120),
    });
    expect(seen.url?.searchParams.get("query")).toHaveLength(100);
  });
});

/** `GET /admin/payouts/{payoutId}` — `AdminPayoutDetailDto` (koala-backend#265). */
describe("getPayoutDetail", () => {
  it("reads the evidence fields, settlement tasks and linked attempts", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(apiUrl(payoutPath(PAYOUT_ID)), ({ request }) => {
        authorization = request.headers.get("authorization");
        return success(adminPayoutDetailFixture());
      }),
    );

    const detail = await getPayoutDetail("TOKEN", PAYOUT_ID);

    expect(authorization).toBe("Bearer TOKEN");
    expect(detail.providerReference).toBe("iyz-transaction-000033");
    expect(detail.maskedIban).toBe("TR** **** **** **** **** **12 34");
    expect(detail.worker?.email).toBe("ayse@example.com");
    expect(detail.settlementTasks).toHaveLength(2);
    expect(detail.settlementTasks[1]?.lastError).toBe("Provider timeout");
    expect(detail.paymentAttempts[0]?.status).toBe("SUCCEEDED");
  });

  it("tolerates a detail with only the required fields", async () => {
    server.use(
      http.get(apiUrl(payoutPath(PAYOUT_ID)), () =>
        success({
          id: PAYOUT_ID,
          jobAssignmentId: "8c000000-0000-4000-8000-000000000034",
          status: "PENDING",
        }),
      ),
    );

    const detail = await getPayoutDetail("TOKEN", PAYOUT_ID);

    expect(detail.settlementTasks).toEqual([]);
    expect(detail.paymentAttempts).toEqual([]);
    expect(detail.amount).toBeNull();
  });
});

/** koala-admin#100 / koala-backend#283: `workerId` süzgeci ve hakediş kaynağı alanları. */
describe("the worker filter and the #283 payout fields", () => {
  it("sends workerId, still without status, and omits it when null", async () => {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(PAYOUTS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(searchEnvelope(PAYOUTS_PATH));
      }),
    );

    await getPayouts("ACCESS-TOKEN", {
      paging: readPaging({}, PAYOUT_PAGING),
      workerId: "aaaaaaaa-0000-4000-8000-000000000001",
    });
    expect(seen.url?.searchParams.get("workerId")).toBe("aaaaaaaa-0000-4000-8000-000000000001");
    expect(seen.url?.searchParams.has("status")).toBe(false);

    await getPayouts("ACCESS-TOKEN", { paging: readPaging({}, PAYOUT_PAGING), workerId: null });
    expect(seen.url?.searchParams.has("workerId")).toBe(false);
  });

  it("joins a status list into one comma-separated parameter Spring binds as List<PayoutStatus>", async () => {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(PAYOUTS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(searchEnvelope(PAYOUTS_PATH));
      }),
    );

    await getPayouts("ACCESS-TOKEN", {
      paging: readPaging({}, PAYOUT_PAGING),
      status: ["PENDING", "COMPLETED"],
    });
    expect(seen.url?.searchParams.get("status")).toBe("PENDING,COMPLETED");

    await getPayouts("ACCESS-TOKEN", { paging: readPaging({}, PAYOUT_PAGING), status: [] });
    expect(seen.url?.searchParams.has("status")).toBe(false);
  });

  it("reads releaseOrigin, settledAt, reconciledByStaffId and bankAccountId, nulling them otherwise", async () => {
    const id = "9c000000-0000-4000-8000-000000000033";
    let body: unknown = adminPayoutDetailFixture({
      releaseOrigin: "AUTO_COMPLETION",
      settledAt: "2026-09-03T10:15:00Z",
      reconciledByStaffId: "5f000000-0000-4000-8000-000000000055",
      bankAccountId: "3b000000-0000-4000-8000-000000000031",
    });
    server.use(
      http.get(apiUrl(payoutPath(id)), () =>
        HttpResponse.json({
          success: true,
          message: "Getirildi.",
          httpStatus: "200 OK",
          path: payoutPath(id),
          requestId: "rid-payout",
          timeStamp: "2026-09-14T08:00:00Z",
          data: body,
        }),
      ),
    );

    const payout = await getPayoutDetail("ACCESS-TOKEN", id);
    expect(payout.releaseOrigin).toBe("AUTO_COMPLETION");
    expect(payout.settledAt).toBe("2026-09-03T10:15:00Z");
    expect(payout.reconciledByStaffId).toBe("5f000000-0000-4000-8000-000000000055");
    expect(payout.bankAccountId).toBe("3b000000-0000-4000-8000-000000000031");

    body = adminPayoutDetailFixture();
    const legacy = await getPayoutDetail("ACCESS-TOKEN", id);
    expect(legacy.releaseOrigin).toBeNull();
    expect(legacy.settledAt).toBeNull();
    expect(legacy.reconciledByStaffId).toBeNull();
    expect(legacy.bankAccountId).toBeNull();
  });
});
