import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

/**
 * The Server Action, treated as what it is: an endpoint.
 *
 * The form on `/reports` is not what an attacker posts to — the action has its
 * own URL and no gate in front of it. So the assertions that matter here are
 * the ones counting requests to `POST /admin/reports/{id}/review` after a
 * refusal: zero, every time, for the wrong permission and for a missing reason
 * alike.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { initialDecisionState } = await import("@/components/panel/queue/decision-state");
const { REVIEW_MIN_NOTE_LENGTH } = await import("@/server/api/reports");
const { submitReportReview } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const REVIEW = apiUrl("/admin/reports/:reportId/review");

const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const GOOD_NOTE = "Mesaj kayıtları şikayeti doğruladı.";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

function watchReview(respond?: () => Response) {
  const seen: { calls: number; body: unknown } = { calls: 0, body: null };

  server.use(
    http.post(REVIEW, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.json();

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Şikayet sonuçlandırıldı.",
        httpStatus: "200 OK",
        path: `/admin/reports/${REPORT_ID}/review`,
        correlationId: "cid-review",
        timeStamp: "2026-09-06T09:31:00.000000000Z",
        data: {
          id: REPORT_ID,
          reportedUserId: "u-1",
          jobId: null,
          messageId: null,
          imageId: null,
          reason: "HARASSMENT",
          description: "Küfür etti.",
          status: "ACTIONED",
          reviewNote: GOOD_NOTE,
          reviewedAt: "2026-09-06T09:31:00Z",
          createdAt: "2026-09-01T08:00:00Z",
        },
      });
    }),
  );

  return seen;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const submit = (fields: Record<string, string>) =>
  submitReportReview(initialDecisionState, form(fields));

describe("the action refuses before it acts", () => {
  it("will not review for a caller without content.moderate, and sends nothing", async () => {
    stubMe(["dispute.resolve", "user.read"]);
    const review = watchReview();

    const state = await submit({ reportId: REPORT_ID, decision: "ACTIONED", note: GOOD_NOTE });

    expect(review.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("İçerik denetle");
  });

  it("will not review without a written reason", async () => {
    stubMe(["content.moderate"]);
    const review = watchReview();

    const state = await submit({ reportId: REPORT_ID, decision: "ACTIONED", note: "kısa" });

    expect(review.calls).toBe(0);
    expect(state.field).toBe("note");
    expect(state.message).toContain(String(REVIEW_MIN_NOTE_LENGTH));
  });

  it("counts a reason of only spaces as no reason", async () => {
    stubMe(["content.moderate"]);
    const review = watchReview();

    const state = await submit({ reportId: REPORT_ID, decision: "ACTIONED", note: "          " });

    expect(review.calls).toBe(0);
    expect(state.field).toBe("note");
  });

  it("refuses a status that is not one of the three verdicts", async () => {
    // `OPEN` is a real ReportStatus and deliberately not offered: re-opening is
    // the absence of a decision, and would erase a colleague's UNDER_REVIEW.
    stubMe(["content.moderate"]);
    const review = watchReview();

    const state = await submit({ reportId: REPORT_ID, decision: "OPEN", note: GOOD_NOTE });

    expect(review.calls).toBe(0);
    expect(state.field).toBe("decision");
  });

  it("refuses a submission with no report id", async () => {
    stubMe(["content.moderate"]);
    const review = watchReview();

    const state = await submit({ decision: "ACTIONED", note: GOOD_NOTE });

    expect(review.calls).toBe(0);
    expect(state.outcome).toBe("error");
  });
});

describe("the action, when it is allowed to act", () => {
  it("posts the verdict and the reason, and reports what was recorded", async () => {
    stubMe(["content.moderate"]);
    const review = watchReview();

    const state = await submit({ reportId: REPORT_ID, decision: "ACTIONED", note: GOOD_NOTE });

    expect(review.calls).toBe(1);
    expect(review.body).toEqual({ status: "ACTIONED", note: GOOD_NOTE });
    expect(state.outcome).toBe("success");
    expect(state.message).toContain("Haklı bulundu");
    // The mobile side reads the same row through GET /reports/me.
    expect(state.message).toContain("/reports/me");
  });

  it("trims the reason before sending it", async () => {
    stubMe(["content.moderate"]);
    const review = watchReview();

    await submit({ reportId: REPORT_ID, decision: "DISMISSED", note: `  ${GOOD_NOTE}  ` });

    expect(review.body).toEqual({ status: "DISMISSED", note: GOOD_NOTE });
  });

  it("explains a 409 as somebody else having already decided", async () => {
    stubMe(["content.moderate"]);
    watchReview(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Şikayet zaten sonuçlandırılmış.",
          httpStatus: "409 CONFLICT",
          errorCode: "REPORT_ALREADY_REVIEWED",
          errorCategory: "DATA_CONFLICT",
          correlationId: "cid-409",
          path: `/admin/reports/${REPORT_ID}/review`,
          timeStamp: "2026-09-06T09:32:00.000000000Z",
        },
        { status: 409 },
      ),
    );

    const state = await submit({ reportId: REPORT_ID, decision: "ACTIONED", note: GOOD_NOTE });

    expect(state.outcome).toBe("error");
    expect(state.message).toContain("sizden önce sonuçlandırılmış olabilir");
    expect(state.correlationId).toBe("cid-409");
  });

  it("shows a backend refusal as the backend's, even though the panel let it through", async () => {
    stubMe(["content.moderate"]);
    watchReview(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          correlationId: "cid-403",
          path: `/admin/reports/${REPORT_ID}/review`,
          timeStamp: "2026-09-06T09:33:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const state = await submit({ reportId: REPORT_ID, decision: "ACTIONED", note: GOOD_NOTE });

    expect(state.message).toContain("Yetki kararını backend verir.");
  });
});
