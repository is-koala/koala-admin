import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";
import { adminAssignmentFixture } from "../../../test/fixtures/admin-assignment";

import { isKoalaApiError } from "./errors";
import {
  ASSIGNMENT_PAGING,
  ASSIGNMENTS_PATH,
  escrowRefundPath,
  escrowReleasePath,
  escrowSummaryPath,
  getAdminAssignments,
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
    requestId: "rid-escrow",
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

const SUMMARY = adminAssignmentFixture({ id: ASSIGNMENT });

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
  it("POSTs the audit reason exactly, without an amount", async () => {
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

    const reason = "İşçi işi tamamladı; kanıtlar teslimatı doğruluyor.";
    const payout = await releaseEscrow("ACCESS-TOKEN", ASSIGNMENT, reason);

    expect(method).toBe("POST");
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(JSON.parse(body ?? "null")).toEqual({ reason });
    // The amount is `assignment.getWorkerPayout()`, chosen by the backend.
    expect(JSON.parse(body ?? "null")).not.toHaveProperty("amount");
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
            requestId: "rid-409",
            path: escrowReleasePath(ASSIGNMENT),
            timeStamp: "2026-09-06T09:31:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const error = await releaseEscrow("ACCESS-TOKEN", ASSIGNMENT, "Kanıtlar doğrulandı.").catch(
      (e: unknown) => e,
    );

    expect(isKoalaApiError(error)).toBe(true);
    if (!isKoalaApiError(error)) throw new Error("unreachable");
    expect(error.message).toBe("Açık bir uyuşmazlık varken emanetteki para çıkarılamaz.");
    expect(error.errorCode).toBe("DISPUTE_BLOCKS_RELEASE");
    expect(error.requestId).toBe("rid-409");
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
          requestId: "rid-refund",
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
    expect(meta.requestId).toBe("rid-refund");
  });

  it("does not silently truncate a reason before transport", async () => {
    let body: { reason?: string } | undefined;

    server.use(
      http.post(apiUrl(escrowRefundPath(ASSIGNMENT)), async ({ request }) => {
        body = (await request.json()) as { reason?: string };
        return HttpResponse.json({
          success: true,
          message: "İade kaydı oluşturuldu.",
          httpStatus: "200 OK",
          path: escrowRefundPath(ASSIGNMENT),
          requestId: null,
          timeStamp: "2026-09-06T09:32:00.000000000Z",
        });
      }),
    );

    await refundEmployer("ACCESS-TOKEN", ASSIGNMENT, "x".repeat(513));

    expect(body?.reason).toHaveLength(513);
  });
});

describe("the assignment list", () => {
  it("pages GET /admin/job-assignments with the staff default sort", async () => {
    let url: URL | null = null;
    server.use(
      http.get(apiUrl(ASSIGNMENTS_PATH), ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json({
          ...envelope(ASSIGNMENTS_PATH, {
            content: [SUMMARY],
            page: 0,
            size: 20,
            totalElements: 1,
            totalPages: 1,
            first: true,
            last: true,
          }),
        });
      }),
    );

    const page = await getAdminAssignments("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: ASSIGNMENT_PAGING.defaultSort },
    });

    expect(url).not.toBeNull();
    const params = url as unknown as URL;
    expect(params.pathname.endsWith("/admin/job-assignments")).toBe(true);
    expect(params.searchParams.has("query")).toBe(false);
    expect(params.searchParams.get("sort")).toBe("createdAt,desc");
    expect(page.content[0]?.id).toBe(ASSIGNMENT);
    expect(page.content[0]?.pricing.employerTotal).toBe("1378.33");
    expect(page.content[0]).not.toHaveProperty("email");
  });
});

describe("the escrow summary read", () => {
  it("preserves the backend's nested pricing snapshot", async () => {
    server.use(
      http.get(apiUrl(escrowSummaryPath(ASSIGNMENT)), () =>
        HttpResponse.json(envelope(escrowSummaryPath(ASSIGNMENT), SUMMARY)),
      ),
    );

    const summary = await getEscrowSummary("ACCESS-TOKEN", ASSIGNMENT);

    expect(summary.paymentStatus).toBe("HELD_IN_ESCROW");
    expect(summary.pricing.workerPayout).toBe("1240.50");
    expect(summary.pricing.serviceFeeAmount).toBe("137.83");
    expect(summary.pricing.serviceFeeRate).toBe("0.1000");
    expect(summary.pricing.employerTotal).toBe("1378.33");
    expect(summary.worker?.firstName).toBe("Ayşe");
  });

  it.each(["workerPayout", "serviceFeeAmount", "serviceFeeRate", "employerTotal"] as const)(
    "rejects numeric drift in pricing.%s instead of losing BigDecimal precision",
    async (field) => {
      server.use(
        http.get(apiUrl(escrowSummaryPath(ASSIGNMENT)), () =>
          HttpResponse.json(
            envelope(escrowSummaryPath(ASSIGNMENT), {
              ...SUMMARY,
              pricing: { ...SUMMARY.pricing, [field]: 1240.5 },
            }),
          ),
        ),
      );

      const error = await getEscrowSummary("ACCESS-TOKEN", ASSIGNMENT).catch(
        (caught: unknown) => caught,
      );

      expect(isKoalaApiError(error)).toBe(true);
      if (!isKoalaApiError(error)) throw new Error("unreachable");
      expect(error.errorCode).toBe("RESPONSE_SCHEMA_MISMATCH");
    },
  );

  it("reports a payment.read denial explicitly", async () => {
    server.use(
      http.get(apiUrl(escrowSummaryPath(ASSIGNMENT)), () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu işlem için yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-403",
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
describe("the assignment search goes to the backend as query", () => {
  function watchSearch() {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(ASSIGNMENTS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(searchEnvelope(ASSIGNMENTS_PATH));
      }),
    );
    return seen;
  }

  it("forwards a trimmed search as query", async () => {
    const seen = watchSearch();

    await getAdminAssignments("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: ASSIGNMENT_PAGING.defaultSort },
      query: "  Ayşe Yılmaz  ",
    });

    expect(seen.url?.searchParams.get("query")).toBe("Ayşe Yılmaz");
  });

  it("sends no query for one character, and clips at 100", async () => {
    const seen = watchSearch();

    await getAdminAssignments("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: ASSIGNMENT_PAGING.defaultSort },
      query: "a",
    });
    expect(seen.url?.searchParams.has("query")).toBe(false);

    await getAdminAssignments("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: ASSIGNMENT_PAGING.defaultSort },
      query: "k".repeat(120),
    });
    expect(seen.url?.searchParams.get("query")).toHaveLength(100);
  });
});
