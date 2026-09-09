import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { INITIAL_PAYOUT_RECONCILIATION_STATE } from "@/lib/payout-reconciliation";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { submitPayoutReconciliation } = await import("./actions");

const PAYOUT_ID = "9c000000-0000-4000-8000-000000000033";
const OTHER_PAYOUT_ID = "9c000000-0000-4000-8000-000000000099";
const ADMIN_ME = apiUrl("/admin/me");
const RECONCILE = apiUrl("/admin/payouts/:payoutId/reconcile");

const GOOD_FIELDS = {
  payoutId: PAYOUT_ID,
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

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[]) {
  const seen = { calls: 0 };
  server.use(
    http.get(ADMIN_ME, () => {
      seen.calls += 1;
      return HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      });
    }),
  );
  return seen;
}

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

function watchReconcile(respond: () => Response = success) {
  const seen = { calls: 0, body: null as unknown };
  server.use(
    http.post(RECONCILE, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.json();
      return respond();
    }),
  );
  return seen;
}

function data(fields: Record<string, string> = GOOD_FIELDS): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

function submit(fields: Record<string, string> = GOOD_FIELDS) {
  return submitPayoutReconciliation(INITIAL_PAYOUT_RECONCILIATION_STATE, data(fields));
}

describe("the reconciliation action fails closed", () => {
  it("re-resolves payout.reconcile and sends no mutation for another finance permission", async () => {
    stubMe(["payout.release", "finance.read"]);
    const reconcile = watchReconcile();

    const state = await submit();

    expect(reconcile.calls).toBe(0);
    expect(state.status).toBe("BLOCKED");
    expect(state.message).toContain("Hakedişi banka ekstresiyle mutabık kıl");
  });

  it("re-resolves permission even when the submitted evidence is malformed", async () => {
    const me = stubMe(["payout.reconcile"]);
    const reconcile = watchReconcile();

    await submit({ ...GOOD_FIELDS, amount: "not-money" });

    expect(me.calls).toBe(1);
    expect(reconcile.calls).toBe(0);
  });

  it.each([
    ["payoutId", "not-a-uuid"],
    ["settlementReference", ""],
    ["providerReference", "x".repeat(129)],
    ["amount", "1.234"],
    ["amount", "123456789012345678.00"],
    ["amount", "0.00"],
    ["currency", "TR"],
    ["settledAt", "2026-09-09T09:30:00"],
    ["settledAt", "2026-02-30T09:30:00Z"],
    ["settledAt", "2026-09-09T09:30:00+18:30"],
    ["settledAt", "2999-01-01T00:00:00Z"],
  ])("sends no reconcile request when %s is malformed", async (field, value) => {
    stubMe(["payout.reconcile"]);
    const reconcile = watchReconcile();

    const state = await submit({ ...GOOD_FIELDS, [field]: value });

    expect(reconcile.calls).toBe(0);
    expect(state.status).toBe("BLOCKED");
    expect(state.field).toBe(field);
  });
});

describe("the reconciliation action keeps the backend authoritative", () => {
  it("canonicalizes an uppercase payout UUID before sending and comparing the response", async () => {
    stubMe(["payout.reconcile"]);
    const reconcile = watchReconcile();

    const state = await submit({ ...GOOD_FIELDS, payoutId: PAYOUT_ID.toUpperCase() });

    expect(reconcile.calls).toBe(1);
    expect(state.status).toBe("SUCCEEDED");
    expect(state.payout?.id).toBe(PAYOUT_ID);
  });

  it("forwards exact trimmed evidence, keeping the amount as decimal text", async () => {
    stubMe(["payout.reconcile"]);
    const reconcile = watchReconcile();

    const state = await submit({
      ...GOOD_FIELDS,
      settlementReference: `  ${GOOD_FIELDS.settlementReference}  `,
      amount: "12345678901234567.89",
    });

    expect(reconcile.calls).toBe(1);
    expect(reconcile.body).toEqual({
      settlementReference: GOOD_FIELDS.settlementReference,
      providerReference: GOOD_FIELDS.providerReference,
      amount: "12345678901234567.89",
      currency: "TRY",
      settledAt: GOOD_FIELDS.settledAt,
    });
    expect(typeof (reconcile.body as { amount: unknown }).amount).toBe("string");
    expect(state.status).toBe("SUCCEEDED");
    expect(state.payout).toEqual({
      id: PAYOUT_ID,
      amount: "12345678901234567.89",
      currency: "TRY",
      completedAt: "2026-09-09T09:30:00Z",
    });
  });

  it.each([
    [400, "PAYOUT_SETTLEMENT_EVIDENCE_MISMATCH", "Ekstre tutarı eşleşmiyor."],
    [404, "PAYOUT_NOT_FOUND", "Hakediş bulunamadı."],
    [409, "PAYOUT_SETTLEMENT_REFERENCE_CONFLICT", "Hakediş başka referansla tamamlanmış."],
  ])("keeps a backend %i message and request id", async (status, errorCode, message) => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() =>
      HttpResponse.json(
        {
          success: false,
          message,
          httpStatus: `${status} ERROR`,
          errorCode,
          errorCategory:
            status === 404
              ? "RESOURCE_NOT_FOUND"
              : status === 409
                ? "DATA_CONFLICT"
                : "BUSINESS_RULE_VIOLATION",
          requestId: `rid-${status}`,
          path: `/admin/payouts/${PAYOUT_ID}/reconcile`,
          timeStamp: "2026-09-09T09:31:00Z",
        },
        { status },
      ),
    );

    const state = await submit();

    expect(state.status).toBe("REFUSED");
    expect(state.message).toBe(message);
    expect(state.errorCode).toBe(errorCode);
    expect(state.requestId).toBe(`rid-${status}`);
    expect(state.payout).toBeNull();
  });

  it("does not expose a backend 5xx detail but keeps its safe request id", async () => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() =>
      HttpResponse.json(
        {
          success: false,
          message: "jdbc:postgresql://internal:5432/koala user=secret",
          httpStatus: "500 INTERNAL_SERVER_ERROR",
          errorCode: "UNEXPECTED",
          errorCategory: "UNEXPECTED",
          requestId: "rid-500",
          path: `/admin/payouts/${PAYOUT_ID}/reconcile`,
          timeStamp: "2026-09-09T09:31:00Z",
        },
        { status: 500 },
      ),
    );

    const state = await submit();

    expect(state.status).toBe("REFUSED");
    expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("postgresql");
    expect(state.requestId).toBe("rid-500");
  });

  it("does not expose a proxy HTML response", async () => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() => HttpResponse.text("<html>proxy upstream secret</html>", { status: 502 }));

    const state = await submit();

    expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("upstream secret");
  });

  it.each([404, 409])(
    "does not expose proxy text just because its status is %i",
    async (status) => {
      stubMe(["payout.reconcile"]);
      watchReconcile(() => HttpResponse.text(`proxy ${status} private route detail`, { status }));

      const state = await submit();

      expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
      expect(state.message).not.toContain("private route detail");
      expect(state.requestId).toBeNull();
    },
  );

  it("keeps a safe request id from a malformed proxy 409 without exposing its message", async () => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() =>
      HttpResponse.json(
        { message: "WAF rule /internal/settlement leaked", requestId: "rid-proxy-409" },
        { status: 409 },
      ),
    );

    const state = await submit();

    expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("WAF rule");
    expect(state.requestId).toBe("rid-proxy-409");
  });

  it("requires a valid backend envelope even when a proxy copies an allowlisted error code", async () => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() =>
      HttpResponse.json(
        {
          message: "forged reconciliation detail",
          errorCode: "PAYOUT_SETTLEMENT_REFERENCE_CONFLICT",
          requestId: "rid-forged",
        },
        { status: 409 },
      ),
    );

    const state = await submit();

    expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("forged");
    expect(state.requestId).toBe("rid-forged");
  });

  it("does not expose response-schema diagnostics but keeps the request id", async () => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() => success({ ...PAYOUT, failureReason: undefined }));

    const state = await submit();

    expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("failureReason");
    expect(state.requestId).toBe("rid-reconcile");
  });

  it("does not expose an unexpected local error message", async () => {
    stubMe(["payout.reconcile"]);
    watchReconcile();
    getKoalaAccessToken
      .mockResolvedValueOnce("ACCESS-TOKEN")
      .mockRejectedValueOnce(new Error("secret session parser detail"));

    const state = await submit();

    expect(state.message).toBe("Mutabakat gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("secret session");
    expect(state.requestId).toBeNull();
  });

  it.each([
    ["another payout id", { ...PAYOUT, id: OTHER_PAYOUT_ID }],
    ["a non-completed status", { ...PAYOUT, status: "PROCESSING", completedAt: null }],
  ])("does not report success for %s", async (_case, response) => {
    stubMe(["payout.reconcile"]);
    watchReconcile(() => success(response));

    const state = await submit();

    expect(state.status).toBe("REFUSED");
    expect(state.payout).toBeNull();
    expect(state.message).toContain("doğrulanamadı");
  });

  it("allows the same evidence to reach backend idempotency on a later submission", async () => {
    const me = stubMe(["payout.reconcile"]);
    const reconcile = watchReconcile();

    const first = await submit();
    const second = await submit();

    expect(first.status).toBe("SUCCEEDED");
    expect(second.status).toBe("SUCCEEDED");
    expect(me.calls).toBe(2);
    expect(reconcile.calls).toBe(2);
  });
});
