import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";
import {
  ASSIGNMENT_ID,
  PAYMENT_ID,
  adminPaymentFixture,
  envelope,
} from "../../../test/fixtures/admin-detail";

import { isKoalaApiError } from "./errors";
import {
  assignmentPaymentsPath,
  getAssignmentPayments,
  getPayment,
  paymentCurrency,
  paymentPath,
} from "./payments";

/**
 * `GET /admin/job-assignments/{id}/payments` ve `GET /admin/payments/{id}`
 * (koala-backend#265), `AdminController` ile karşılaştırılarak.
 */

describe("payment attempt paths", () => {
  it("encodes the ids into the two admin paths", () => {
    expect(assignmentPaymentsPath(ASSIGNMENT_ID)).toBe(
      `/admin/job-assignments/${ASSIGNMENT_ID}/payments`,
    );
    expect(paymentPath(PAYMENT_ID)).toBe(`/admin/payments/${PAYMENT_ID}`);
    expect(paymentPath("a/b")).toBe("/admin/payments/a%2Fb");
  });
});

describe("getAssignmentPayments", () => {
  it("reads the list with the bearer token and keeps money as text", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(apiUrl(assignmentPaymentsPath(ASSIGNMENT_ID)), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(
          envelope(assignmentPaymentsPath(ASSIGNMENT_ID), [adminPaymentFixture()]),
        );
      }),
    );

    const payments = await getAssignmentPayments("TOKEN", ASSIGNMENT_ID);

    expect(authorization).toBe("Bearer TOKEN");
    expect(payments).toHaveLength(1);
    expect(payments[0]?.totalCharged).toBe("1378.33");
    expect(payments[0]?.refunds[0]?.amount).toBe("1378.33");
    expect(payments[0]?.verificationAttempts).toBe(2);
  });

  it("accepts an empty list and absent optional fields", async () => {
    server.use(
      http.get(apiUrl(assignmentPaymentsPath(ASSIGNMENT_ID)), () =>
        HttpResponse.json(
          envelope(assignmentPaymentsPath(ASSIGNMENT_ID), [
            {
              id: PAYMENT_ID,
              jobAssignmentId: ASSIGNMENT_ID,
              status: "INITIATED",
            },
          ]),
        ),
      ),
    );

    const [payment] = await getAssignmentPayments("TOKEN", ASSIGNMENT_ID);

    expect(payment?.status).toBe("INITIATED");
    expect(payment?.refunds).toEqual([]);
    expect(payment?.worker).toBeNull();
    expect(payment?.totalCharged).toBeNull();
    expect(paymentCurrency(payment ?? { currency: null, pricing: null })).toBe("TRY");
  });

  it("rejects an unknown attempt status at the boundary", async () => {
    server.use(
      http.get(apiUrl(assignmentPaymentsPath(ASSIGNMENT_ID)), () =>
        HttpResponse.json(
          envelope(assignmentPaymentsPath(ASSIGNMENT_ID), [
            adminPaymentFixture({ status: "MYSTERY" }),
          ]),
        ),
      ),
    );

    await expect(getAssignmentPayments("TOKEN", ASSIGNMENT_ID)).rejects.toThrow();
  });
});

describe("getPayment", () => {
  it("surfaces the backend's 404 as a resource-not-found error", async () => {
    server.use(
      http.get(apiUrl(paymentPath(PAYMENT_ID)), () =>
        HttpResponse.json(
          {
            success: false,
            message: "Ödeme kaydı bulunamadı.",
            httpStatus: "404 NOT_FOUND",
            errorCode: "PAYMENT_NOT_FOUND",
            errorCategory: "RESOURCE_NOT_FOUND",
            requestId: "rid-404",
            path: paymentPath(PAYMENT_ID),
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 404 },
        ),
      ),
    );

    const error = await getPayment("TOKEN", PAYMENT_ID).catch((thrown: unknown) => thrown);

    expect(isKoalaApiError(error)).toBe(true);
    if (isKoalaApiError(error)) expect(error.isResourceNotFound).toBe(true);
  });

  it("prefers the DTO currency, then the pricing currency", () => {
    expect(paymentCurrency({ currency: "EUR", pricing: null })).toBe("EUR");
    expect(
      paymentCurrency({
        currency: null,
        pricing: {
          pricingVersion: "v1",
          currency: "USD",
          workerPayout: "1",
          serviceFeeRate: "0",
          serviceFeeAmount: "0",
          employerTotal: "1",
        },
      }),
    ).toBe("USD");
  });
});

/** koala-admin#100 / koala-backend#283: `payoutId` ve iadenin kaynağı. */
describe("payout id and refund origin", () => {
  it("reads origin, originId and payoutId, and nulls them for a #265 server", async () => {
    const refunds = adminPaymentFixture().refunds as Array<Record<string, unknown>>;
    let body: unknown = adminPaymentFixture({
      payoutId: "9c000000-0000-4000-8000-000000000033",
      refunds: [
        { ...refunds[0], origin: "DISPUTE", originId: "6d000000-0000-4000-8000-000000000061" },
      ],
    });
    server.use(
      http.get(apiUrl(paymentPath(PAYMENT_ID)), () =>
        HttpResponse.json(envelope(paymentPath(PAYMENT_ID), body)),
      ),
    );

    const payment = await getPayment("TOKEN", PAYMENT_ID);
    expect(payment.payoutId).toBe("9c000000-0000-4000-8000-000000000033");
    expect(payment.refunds[0]?.origin).toBe("DISPUTE");
    expect(payment.refunds[0]?.originId).toBe("6d000000-0000-4000-8000-000000000061");

    body = adminPaymentFixture();
    const legacy = await getPayment("TOKEN", PAYMENT_ID);
    expect(legacy.payoutId).toBeNull();
    expect(legacy.refunds[0]?.origin).toBeNull();
    expect(legacy.refunds[0]?.originId).toBeNull();
  });

  it("rejects a refund origin the panel cannot name", async () => {
    const refunds = adminPaymentFixture().refunds as Array<Record<string, unknown>>;
    server.use(
      http.get(apiUrl(paymentPath(PAYMENT_ID)), () =>
        HttpResponse.json(
          envelope(
            paymentPath(PAYMENT_ID),
            adminPaymentFixture({ refunds: [{ ...refunds[0], origin: "CHARGEBACK" }] }),
          ),
        ),
      ),
    );

    await expect(getPayment("TOKEN", PAYMENT_ID)).rejects.toThrow();
  });
});
