import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  /**
   * Bu dosyadaki her 403 gerçekten "personel kaydı çözülemedi" demek, ve
   * `staff-context.ts` bunu backend'e sorarak doğruluyor. Sabit `false`,
   * o sorunun burada verilen cevabı.
   */
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { clearEscrowSubmissions, runEscrowOperation } = await import("./operations");
const { clearRecentOperations, recentOperations } = await import("./recent-operations");

/**
 * The money paths, tested the way koala-admin#6 asks for them to be tested.
 *
 * Every assertion in this file that matters is a **request count**. "The panel
 * does not send a second release" and "the panel does not ask when it is not
 * allowed to" are claims about the network, and a test that only inspected the
 * returned message would pass just as happily against code that fired the
 * request and then discarded the answer.
 */

const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";
const DISPUTE = "d1000000-0000-4c00-8000-000000000001";

const ME = apiUrl("/admin/me");
const SUMMARY = apiUrl(`/admin/job-assignments/${ASSIGNMENT}`);
const RELEASE = apiUrl(`/admin/job-assignments/${ASSIGNMENT}/release`);
const REFUND = apiUrl(`/admin/job-assignments/${ASSIGNMENT}/refund`);
const RESOLVE = apiUrl(`/admin/disputes/${DISPUTE}/resolve`);

const ALL_MONEY_PERMISSIONS = ["dispute.resolve", "payout.release", "payment.refund"];

const REASON = "İşçi işi tamamladı, işverenin itirazı kanıtlanamadı.";

interface Counter {
  readonly count: number;
}

function counter(): { bump: () => void } & Counter {
  let value = 0;
  return {
    bump: () => {
      value += 1;
    },
    get count() {
      return value;
    },
  };
}

function envelope(path: string, data: unknown) {
  return {
    success: true,
    message: "İşlem tamam.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-op",
    timeStamp: "2026-09-06T10:00:00.000000000Z",
    data,
  };
}

const SUMMARY_BODY = {
  id: ASSIGNMENT,
  status: "COMPLETED",
  paymentStatus: "HELD_IN_ESCROW",
  currency: "TRY",
  workerPayout: "1240.50",
  commissionAmount: "137.83",
  commissionRate: "0.1000",
  totalCharged: "1378.33",
  workHours: 8,
  jobTitle: "Garsonluk",
  worker: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
  employer: { id: "e-1", firstName: "Mehmet", lastName: "Demir", username: "mehmet" },
  companyName: "Koala Kafe",
  settledPayment: {
    id: "p-1",
    currency: "TRY",
    totalCharged: "1378.33",
    workerPayout: "1240.50",
    commissionAmount: "137.83",
    commissionRate: "0.1000",
    completedAt: "2026-09-01T10:00:00.000000000Z",
  },
};

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ME, () =>
      HttpResponse.json(
        envelope("/admin/me", {
          staffId: "staff-1",
          displayName: "Trust Lideri",
          email: "trust-lead@koala.local",
          roles: ["TRUST_LEAD"],
          permissions: [...permissions],
        }),
      ),
    ),
  );
}

function stubSummary(body: unknown = SUMMARY_BODY) {
  const calls = counter();
  server.use(
    http.get(SUMMARY, () => {
      calls.bump();
      return HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, body));
    }),
  );
  return calls;
}

function stubRelease(delayMs = 0) {
  const calls = counter();
  server.use(
    http.post(RELEASE, async () => {
      calls.bump();
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
      return HttpResponse.json(
        envelope(`/admin/job-assignments/${ASSIGNMENT}/release`, {
          id: "payout-1",
          jobAssignmentId: ASSIGNMENT,
          amount: "1240.50",
          currency: "TRY",
          status: "PENDING",
          failureReason: null,
          completedAt: null,
          createdAt: "2026-09-06T10:00:00.000000000Z",
        }),
      );
    }),
  );
  return calls;
}

let keyCounter = 0;
const nextKey = () => `op-${(keyCounter += 1)}`;

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  clearEscrowSubmissions();
  clearRecentOperations();
  stubMe(ALL_MONEY_PERMISSIONS);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function releaseRequest(overrides: Partial<Parameters<typeof runEscrowOperation>[0]> = {}) {
  return {
    operationKey: nextKey(),
    kind: "RELEASE" as const,
    assignmentId: ASSIGNMENT,
    disputeId: DISPUTE,
    resolution: null,
    reason: REASON,
    confirmedAmount: "1240.5",
    ...overrides,
  };
}

describe("a release that should go through", () => {
  it("re-reads the amount, sends one request, and reports the backend's own figure", async () => {
    const summary = stubSummary();
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest());

    expect(outcome.status).toBe("SUCCEEDED");
    expect(summary.count).toBe(1);
    expect(release.count).toBe(1);
    // ₺1.240,50 — through lib/format, from the payout the backend returned,
    // not from the figure that was confirmed.
    expect(outcome.amountText).toBe("₺1.240,50");
  });

  it("records what happened, after the backend answered and from its answer", async () => {
    stubSummary();
    stubRelease();

    await runEscrowOperation(releaseRequest());

    const [recorded] = recentOperations();
    expect(recorded).toMatchObject({
      kind: "RELEASE",
      outcome: "SUCCEEDED",
      assignmentId: ASSIGNMENT,
      actor: "Trust Lideri",
      beneficiary: "Ayşe Yılmaz",
      amountText: "₺1.240,50",
      reason: REASON,
    });
  });
});

describe("double submission", () => {
  it("collapses two simultaneous submissions of one confirmation into one request", async () => {
    const release = stubRelease(25);
    stubSummary();
    const request = releaseRequest();

    // What a double click produces: the second submission starts before the
    // first has come back, so neither the backend's state guards nor a
    // "disabled" attribute would have separated them.
    const [first, second] = await Promise.all([
      runEscrowOperation(request),
      runEscrowOperation(request),
    ]);

    expect(release.count).toBe(1);
    expect(first.status).toBe("SUCCEEDED");
    expect(second.status).toBe("SUCCEEDED");
    // One of the two is told it was a duplicate rather than being lied to.
    expect(second.deduplicated).toBe(true);
    expect(recentOperations()).toHaveLength(1);
  });

  it("replays a completed confirmation without sending anything", async () => {
    stubSummary();
    const release = stubRelease();
    const request = releaseRequest();

    await runEscrowOperation(request);
    const replay = await runEscrowOperation(request);

    expect(release.count).toBe(1);
    expect(replay.deduplicated).toBe(true);
    expect(replay.status).toBe("SUCCEEDED");
  });

  it("lets a refused operation be retried, since nothing moved", async () => {
    stubSummary();
    const release = counter();
    let refuse = true;
    server.use(
      http.post(RELEASE, () => {
        release.bump();
        if (refuse) {
          return HttpResponse.json(
            {
              success: false,
              message: "Açık bir uyuşmazlık varken emanetteki para çıkarılamaz.",
              httpStatus: "409 CONFLICT",
              errorCode: "DISPUTE_BLOCKS_RELEASE",
              errorCategory: "DATA_CONFLICT",
              requestId: "rid-409",
              path: `/admin/job-assignments/${ASSIGNMENT}/release`,
              timeStamp: "2026-09-06T10:00:00.000000000Z",
            },
            { status: 409 },
          );
        }
        return HttpResponse.json(
          envelope(`/admin/job-assignments/${ASSIGNMENT}/release`, {
            id: "payout-1",
            jobAssignmentId: ASSIGNMENT,
            amount: "1240.50",
            currency: "TRY",
            status: "PENDING",
            failureReason: null,
            completedAt: null,
            createdAt: "2026-09-06T10:00:00.000000000Z",
          }),
        );
      }),
    );

    const request = releaseRequest();
    const refused = await runEscrowOperation(request);
    expect(refused.status).toBe("REFUSED");

    refuse = false;
    const retried = await runEscrowOperation(request);

    expect(retried.status).toBe("SUCCEEDED");
    expect(release.count).toBe(2);
  });
});

describe("the confirmed amount has to be the server's amount", () => {
  it("refuses a stale figure and sends no money request at all", async () => {
    const summary = stubSummary();
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest({ confirmedAmount: "1240.49" }));

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("AMOUNT_CHANGED");
    expect(summary.count).toBe(1);
    // The decisive number.
    expect(release.count).toBe(0);
  });

  it("accepts the same amount written differently, because money is not a float", async () => {
    stubSummary();
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest({ confirmedAmount: "1240.50" }));

    expect(outcome.status).toBe("SUCCEEDED");
    expect(release.count).toBe(1);
  });

  it("will not move money it cannot price, even when the read succeeds", async () => {
    stubSummary({ ...SUMMARY_BODY, workerPayout: null });
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest());

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("AMOUNT_UNAVAILABLE");
    expect(release.count).toBe(0);
  });

  it("fails closed when the amount cannot be read at all", async () => {
    // This is today's behaviour: GET /admin/job-assignments/{id} is unmapped,
    // and koala-backend#14 answers an unmapped /admin path with 403.
    const release = stubRelease();
    server.use(
      http.get(SUMMARY, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu işlem için yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-403",
            path: `/admin/job-assignments/${ASSIGNMENT}`,
            timeStamp: "2026-09-06T10:00:00.000000000Z",
          },
          { status: 403 },
        ),
      ),
    );

    const outcome = await runEscrowOperation(releaseRequest());

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("Tutar sunucudan doğrulanamadığı için");
    expect(release.count).toBe(0);
  });
});

describe("permission, re-resolved on the server for every submission", () => {
  it("refuses a release from someone without payout.release, and asks the backend nothing", async () => {
    stubMe(["dispute.resolve"]);
    const summary = stubSummary();
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest());

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("PANEL_PERMISSION_DENIED");
    expect(outcome.message).toContain("payout.release");
    // Not even the read. The gate on the page hides the button; this is what
    // stops a POST straight at the Server Action.
    expect(summary.count).toBe(0);
    expect(release.count).toBe(0);
  });

  it("refuses a refund from someone without payment.refund", async () => {
    stubMe(["dispute.resolve", "payout.release"]);
    const refund = counter();
    server.use(
      http.post(REFUND, () => {
        refund.bump();
        return HttpResponse.json({ success: true, message: "ok", httpStatus: "200 OK" });
      }),
    );

    const outcome = await runEscrowOperation(
      releaseRequest({ kind: "REFUND", confirmedAmount: "1378.33" }),
    );

    expect(outcome.status).toBe("BLOCKED");
    expect(refund.count).toBe(0);
  });

  it("moves nothing when it cannot find out what you may do", async () => {
    server.use(
      http.get(ME, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/me",
            timeStamp: "2026-09-06T10:00:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest());

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("BACKEND_UNAVAILABLE");
    expect(release.count).toBe(0);
  });
});

describe("the mandatory reason", () => {
  it("blocks an empty reason before anything is asked of the backend", async () => {
    const summary = stubSummary();
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest({ reason: "   " }));

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("Gerekçe zorunludur");
    expect(summary.count).toBe(0);
    expect(release.count).toBe(0);
  });

  it("wants more than a shrug when money moves", async () => {
    const release = stubRelease();

    const outcome = await runEscrowOperation(releaseRequest({ reason: "tamam" }));

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("en az 10 karakter");
    expect(release.count).toBe(0);
  });
});

describe("the backend's refusal is the operator's message", () => {
  it("shows BLOCKS_RELEASE in the backend's own Turkish, not a generic error", async () => {
    stubSummary();
    server.use(
      http.post(RELEASE, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Açık bir uyuşmazlık varken emanetteki para çıkarılamaz.",
            httpStatus: "409 CONFLICT",
            errorCode: "DISPUTE_BLOCKS_RELEASE",
            errorCategory: "DATA_CONFLICT",
            requestId: "rid-409",
            path: `/admin/job-assignments/${ASSIGNMENT}/release`,
            timeStamp: "2026-09-06T10:00:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const outcome = await runEscrowOperation(releaseRequest());

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.message).toBe("Açık bir uyuşmazlık varken emanetteki para çıkarılamaz.");
    expect(outcome.errorCode).toBe("DISPUTE_BLOCKS_RELEASE");
    expect(outcome.requestId).toBe("rid-409");
    expect(recentOperations()[0]).toMatchObject({
      outcome: "REFUSED",
      errorCode: "DISPUTE_BLOCKS_RELEASE",
    });
  });
});

describe("refund", () => {
  it("confirms against the settled payment's total and sends no amount", async () => {
    stubSummary();
    let body: unknown = undefined;
    server.use(
      http.post(REFUND, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "İade kaydı oluşturuldu.",
          httpStatus: "200 OK",
          path: `/admin/job-assignments/${ASSIGNMENT}/refund`,
          requestId: "rid-refund",
          timeStamp: "2026-09-06T10:00:00.000000000Z",
        });
      }),
    );

    const outcome = await runEscrowOperation(
      releaseRequest({ kind: "REFUND", confirmedAmount: "1378.33" }),
    );

    expect(outcome.status).toBe("SUCCEEDED");
    expect(body).toEqual({ reason: REASON });
    expect(body).not.toHaveProperty("amount");
    // No figure came back — `SuccessResult` carries none — and none is invented.
    expect(outcome.amountText).toBeNull();
    expect(recentOperations()[0]).toMatchObject({ beneficiary: "Mehmet Demir · Koala Kafe" });
  });

  it("refuses when the confirmed figure was the worker's rather than the employer's", async () => {
    stubSummary();
    const refund = counter();
    server.use(
      http.post(REFUND, () => {
        refund.bump();
        return HttpResponse.json({ success: true, message: "ok", httpStatus: "200 OK" });
      }),
    );

    const outcome = await runEscrowOperation(
      releaseRequest({ kind: "REFUND", confirmedAmount: "1240.50" }),
    );

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("AMOUNT_CHANGED");
    expect(refund.count).toBe(0);
  });
});

describe("resolving a dispute", () => {
  function resolveRequest(resolution: string, confirmedAmount: string | null) {
    return {
      operationKey: nextKey(),
      kind: "RESOLVE_DISPUTE" as const,
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: resolution as "RELEASE_TO_WORKER" | "REFUND_EMPLOYER" | "DISMISSED",
      reason: REASON,
      confirmedAmount,
    };
  }

  function stubResolve() {
    const calls = counter();
    let seen: unknown = undefined;
    server.use(
      http.post(RESOLVE, async ({ request }) => {
        calls.bump();
        seen = await request.json();
        return HttpResponse.json(
          envelope(`/admin/disputes/${DISPUTE}/resolve`, {
            id: DISPUTE,
            jobAssignmentId: ASSIGNMENT,
            openedBy: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
            status: "RESOLVED",
            reason: "İtiraz",
            resolution: "DISMISSED",
            resolutionNote: REASON,
            resolvedAt: "2026-09-06T10:00:00.000000000Z",
            createdAt: "2026-09-05T08:00:00.000000000Z",
          }),
        );
      }),
    );
    return {
      calls,
      get body() {
        return seen;
      },
    };
  }

  it("sends the decision and the mandatory reason as the note", async () => {
    stubSummary();
    const resolve = stubResolve();

    const outcome = await runEscrowOperation(resolveRequest("RELEASE_TO_WORKER", "1240.50"));

    expect(outcome.status).toBe("SUCCEEDED");
    expect(resolve.calls.count).toBe(1);
    expect(resolve.body).toEqual({ resolution: "RELEASE_TO_WORKER", note: REASON });
  });

  it("checks the amount for a money-moving decision, because resolve moves money too", async () => {
    const summary = stubSummary();
    const resolve = stubResolve();

    const outcome = await runEscrowOperation(resolveRequest("REFUND_EMPLOYER", "1240.50"));

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.errorCode).toBe("AMOUNT_CHANGED");
    expect(summary.count).toBe(1);
    expect(resolve.calls.count).toBe(0);
  });

  it("asks for no amount and reads no summary when the decision touches no money", async () => {
    const summary = stubSummary();
    const resolve = stubResolve();

    const outcome = await runEscrowOperation(resolveRequest("DISMISSED", null));

    expect(outcome.status).toBe("SUCCEEDED");
    expect(summary.count).toBe(0);
    expect(resolve.calls.count).toBe(1);
    expect(recentOperations()[0]).toMatchObject({ beneficiary: null, amountText: null });
  });

  it("needs a decision", async () => {
    const resolve = stubResolve();

    const outcome = await runEscrowOperation(resolveRequest("", null));

    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("Bir karar seçmelisiniz");
    expect(resolve.calls.count).toBe(0);
  });
});
