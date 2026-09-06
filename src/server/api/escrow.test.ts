import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { isKoalaApiError } from "./errors";
import {
  escrowRefundPath,
  escrowReleasePath,
  escrowSummaryPath,
  getEscrowSummary,
  refundEmployer,
  releaseEscrow,
} from "./escrow";

/**
 * The escrow endpoints, checked against `webAPI/PayoutsController.java` rather
 * than against koala-admin#6's prose.
 *
 * The assertion this file exists for is `body).not.toHaveProperty("amount")`.
 * `RefundRequestDto.amount` is nullable and `PayoutManager.refundEmployer`
 * falls back to `payment.getTotalCharged()` when it is absent — so *not*
 * sending it is what makes the backend the author of the figure that moves. A
 * refactor that helpfully filled the field in would pass every other test in
 * this repo.
 */

const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";

function envelope(path: string, data: unknown) {
  return {
    success: true,
    message: "İşlem tamam.",
    httpStatus: "200 OK",
    path,
    correlationId: "cid-escrow",
    timeStamp: "2026-09-06T09:30:00.000000000Z",
    data,
  };
}

const PAYOUT = {
  id: "77770000-0000-4c00-8000-000000000001",
  jobAssignmentId: ASSIGNMENT,
  amount: 1240.5,
  currency: "TRY",
  status: "PENDING",
  failureReason: null,
  completedAt: null,
  createdAt: "2026-09-06T09:30:00.000000000Z",
};

const SUMMARY = {
  id: ASSIGNMENT,
  status: "COMPLETED",
  paymentStatus: "HELD_IN_ESCROW",
  currency: "TRY",
  workerPayout: 1240.5,
  commissionAmount: 137.83,
  commissionRate: 0.1,
  totalCharged: 1378.33,
  workHours: 8,
  jobTitle: "Garsonluk",
  worker: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
  employer: { id: "e-1", firstName: "Mehmet", lastName: "Demir", username: "mehmet" },
  companyName: "Koala Kafe",
  settledPayment: {
    id: "p-1",
    currency: "TRY",
    totalCharged: 1378.33,
    workerPayout: 1240.5,
    commissionAmount: 137.83,
    commissionRate: 0.1,
    completedAt: "2026-09-01T10:00:00.000000000Z",
  },
};

describe("the paths match the controller, not the issue body", () => {
  it("uses the /admin/job-assignments/{id}/… shape the controller declares", () => {
    expect(escrowReleasePath(ASSIGNMENT)).toBe(`/admin/job-assignments/${ASSIGNMENT}/release`);
    expect(escrowRefundPath(ASSIGNMENT)).toBe(`/admin/job-assignments/${ASSIGNMENT}/refund`);
    expect(escrowSummaryPath(ASSIGNMENT)).toBe(`/admin/job-assignments/${ASSIGNMENT}`);
  });

  it("escapes an id rather than pasting it into the URL", () => {
    expect(escrowReleasePath("a/../b")).toBe("/admin/job-assignments/a%2F..%2Fb/release");
  });
});

describe("release", () => {
  it("POSTs with the bearer token and no body at all", async () => {
    let method: string | null = null;
    let authorization: string | null = null;
    let body: string | null = null;

    server.use(
      http.post(apiUrl(escrowReleasePath(ASSIGNMENT)), async ({ request }) => {
        method = request.method;
        authorization = request.headers.get("authorization");
        body = await request.text();
        return HttpResponse.json(envelope(escrowReleasePath(ASSIGNMENT), PAYOUT));
      }),
    );

    const payout = await releaseEscrow("ACCESS-TOKEN", ASSIGNMENT);

    expect(method).toBe("POST");
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    // The amount is `assignment.getWorkerPayout()`, chosen by the backend. The
    // panel could not override it if it wanted to.
    expect(body).toBe("");
    expect(payout.amount).toBe(1240.5);
    expect(payout.status).toBe("PENDING");
  });

  it("surfaces the backend's Turkish refusal rather than a generic failure", async () => {
    server.use(
      http.post(apiUrl(escrowReleasePath(ASSIGNMENT)), () =>
        HttpResponse.json(
          {
            success: false,
            message: "Açık bir uyuşmazlık varken emanetteki para çıkarılamaz.",
            httpStatus: "409 CONFLICT",
            errorCode: "DISPUTE_BLOCKS_RELEASE",
            errorCategory: "DATA_CONFLICT",
            correlationId: "cid-409",
            path: escrowReleasePath(ASSIGNMENT),
            timeStamp: "2026-09-06T09:31:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const error = await releaseEscrow("ACCESS-TOKEN", ASSIGNMENT).catch((e: unknown) => e);

    expect(isKoalaApiError(error)).toBe(true);
    if (!isKoalaApiError(error)) throw new Error("unreachable");
    expect(error.message).toBe("Açık bir uyuşmazlık varken emanetteki para çıkarılamaz.");
    expect(error.errorCode).toBe("DISPUTE_BLOCKS_RELEASE");
    expect(error.correlationId).toBe("cid-409");
  });
});

describe("refund", () => {
  it("sends a reason and — the point of this file — no amount", async () => {
    let body: unknown = undefined;

    server.use(
      http.post(apiUrl(escrowRefundPath(ASSIGNMENT)), async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "İade kaydı oluşturuldu.",
          httpStatus: "200 OK",
          path: escrowRefundPath(ASSIGNMENT),
          correlationId: "cid-refund",
          timeStamp: "2026-09-06T09:32:00.000000000Z",
        });
      }),
    );

    const meta = await refundEmployer("ACCESS-TOKEN", ASSIGNMENT, "İş hiç yapılmadı.");

    expect(body).toEqual({ reason: "İş hiç yapılmadı." });
    // If this ever starts passing an amount, the panel has become the author of
    // a real transfer's figure. `PayoutManager` uses its own settled payment
    // total when the field is absent.
    expect(body).not.toHaveProperty("amount");
    expect(meta.message).toBe("İade kaydı oluşturuldu.");
    expect(meta.correlationId).toBe("cid-refund");
  });

  it("truncates the reason to the backend's @Size(max = 512)", async () => {
    let body: { reason?: string } | undefined;

    server.use(
      http.post(apiUrl(escrowRefundPath(ASSIGNMENT)), async ({ request }) => {
        body = (await request.json()) as { reason?: string };
        return HttpResponse.json({
          success: true,
          message: "İade kaydı oluşturuldu.",
          httpStatus: "200 OK",
          path: escrowRefundPath(ASSIGNMENT),
          correlationId: null,
          timeStamp: "2026-09-06T09:32:00.000000000Z",
        });
      }),
    );

    await refundEmployer("ACCESS-TOKEN", ASSIGNMENT, "x".repeat(900));

    expect(body?.reason).toHaveLength(512);
  });
});

describe("the escrow summary read", () => {
  it("parses the assignment and its settled payment", async () => {
    server.use(
      http.get(apiUrl(escrowSummaryPath(ASSIGNMENT)), () =>
        HttpResponse.json(envelope(escrowSummaryPath(ASSIGNMENT), SUMMARY)),
      ),
    );

    const summary = await getEscrowSummary("ACCESS-TOKEN", ASSIGNMENT);

    expect(summary.paymentStatus).toBe("HELD_IN_ESCROW");
    expect(summary.workerPayout).toBe(1240.5);
    expect(summary.settledPayment?.totalCharged).toBe(1378.33);
    expect(summary.worker?.firstName).toBe("Ayşe");
  });

  it("accepts a BigDecimal serialised as a string without turning it into a float", async () => {
    server.use(
      http.get(apiUrl(escrowSummaryPath(ASSIGNMENT)), () =>
        HttpResponse.json(
          envelope(escrowSummaryPath(ASSIGNMENT), {
            ...SUMMARY,
            workerPayout: "1240.50",
            settledPayment: { ...SUMMARY.settledPayment, totalCharged: "1378.33" },
          }),
        ),
      ),
    );

    const summary = await getEscrowSummary("ACCESS-TOKEN", ASSIGNMENT);

    // Still a string. Nothing in the panel parses it; `formatCurrency` takes both.
    expect(summary.workerPayout).toBe("1240.50");
    expect(summary.settledPayment?.totalCharged).toBe("1378.33");
  });

  it("reports the 403 an unmapped /admin path answers today", async () => {
    // koala-backend#14 denies by default, so this endpoint is 403 rather than
    // 404 until somebody ships it. The screen renders that, and withholds the
    // money buttons.
    server.use(
      http.get(apiUrl(escrowSummaryPath(ASSIGNMENT)), () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu işlem için yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            correlationId: "cid-403",
            path: escrowSummaryPath(ASSIGNMENT),
            timeStamp: "2026-09-06T09:33:00.000000000Z",
          },
          { status: 403 },
        ),
      ),
    );

    const error = await getEscrowSummary("ACCESS-TOKEN", ASSIGNMENT).catch((e: unknown) => e);

    expect(isKoalaApiError(error)).toBe(true);
    if (!isKoalaApiError(error)) throw new Error("unreachable");
    expect(error.isForbidden).toBe(true);
  });
});
