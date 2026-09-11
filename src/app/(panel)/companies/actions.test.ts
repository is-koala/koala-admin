import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_REVIEW_ID, reviewCompany } from "../../../../test/fixtures/companies";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

/**
 * Approving or rejecting a company through their distinct POST endpoints.
 *
 * Both decisions change backend state and there is no un-approve endpoint, so
 * a call that should not have happened cannot be taken back. That makes "the
 * request was never made" the central authorization and validation assertion.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const revalidatePath = vi.fn<(path: string) => void>();
const redirect = vi.fn<(path: string) => never>((path) => {
  throw new Error(`NEXT_REDIRECT:${path}`);
});

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect }));

const { initialDecisionState } = await import("@/components/panel/queue/decision-state");
const { COMPANY_DECISION_MIN_NOTE_LENGTH } = await import("@/server/api/companies");
const { submitCompanyDecision } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const APPROVE = apiUrl("/admin/companies/:companyId/approve");
const REJECT = apiUrl("/admin/companies/:companyId/reject");

const COMPANY_ID = COMPANY_REVIEW_ID;
const GOOD_NOTE = "Vergi levhası ve imza sirküleri kontrol edildi.";

beforeEach(() => {
  revalidatePath.mockReset();
  redirect.mockClear();
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

function watchApprove(respond?: () => Response) {
  const seen: { calls: number; body: unknown; authorization: string | null } = {
    calls: 0,
    body: null,
    authorization: null,
  };

  server.use(
    http.post(APPROVE, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.json();
      seen.authorization = request.headers.get("authorization");

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Şirket onaylandı.",
        httpStatus: "200 OK",
        path: `/admin/companies/${COMPANY_ID}/approve`,
        requestId: "rid-approve",
        timeStamp: "2026-09-06T09:41:00.000000000Z",
        data: reviewCompany({
          email: null,
          phoneNumber: null,
          approvalStatus: "APPROVED",
          approvalNote: GOOD_NOTE,
          approvalDecidedAt: "2026-09-06T09:41:00Z",
          createdBy: null,
        }),
      });
    }),
  );

  return seen;
}

function watchReject() {
  const seen: { calls: number; body: unknown; authorization: string | null } = {
    calls: 0,
    body: null,
    authorization: null,
  };

  server.use(
    http.post(REJECT, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.json();
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "Şirket reddedildi.",
        data: reviewCompany({
          email: null,
          phoneNumber: null,
          approvalStatus: "REJECTED",
          approvalNote: GOOD_NOTE,
          approvalDecidedAt: "2026-09-06T09:41:00Z",
          createdBy: null,
        }),
      });
    }),
  );

  return seen;
}

function submit(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return submitCompanyDecision(initialDecisionState, data);
}

describe("the action refuses before it decides", () => {
  it("will not approve or reject for a MODERATOR, and sends nothing", async () => {
    // `content.moderate` is not `company.approve`. The form living on another
    // page is not a defence; this action has its own URL.
    stubMe(["content.moderate"]);
    const approve = watchApprove();
    const reject = watchReject();

    const approveState = await submit({
      companyId: COMPANY_ID,
      decision: "APPROVE",
      note: GOOD_NOTE,
    });
    const rejectState = await submit({
      companyId: COMPANY_ID,
      decision: "REJECT",
      note: GOOD_NOTE,
    });

    expect(approve.calls).toBe(0);
    expect(reject.calls).toBe(0);
    expect(approveState.outcome).toBe("error");
    expect(rejectState.outcome).toBe("error");
    expect(approveState.message).toContain("Şirket başvurularını onayla");
  });

  it("will not approve without a written reason", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: "az" });

    expect(approve.calls).toBe(0);
    expect(state.field).toBe("note");
    expect(state.message).toContain(String(COMPANY_DECISION_MIN_NOTE_LENGTH));
  });

  it("keeps an overlong decision note away from both backend mutations", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();
    const reject = watchReject();

    const state = await submit({
      companyId: COMPANY_ID,
      decision: "REJECT",
      note: "x".repeat(1001),
    });

    expect(approve.calls).toBe(0);
    expect(reject.calls).toBe(0);
    expect(state.field).toBe("note");
    expect(state.message).toContain("1000");
  });

  it("refuses any decision outside the backend's two decision endpoints", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "SUSPEND", note: GOOD_NOTE });

    expect(approve.calls).toBe(0);
    expect(state.field).toBe("decision");
    expect(state.message).toContain("Geçerli bir şirket kararı");
  });

  it("refuses a submission with no company id", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    const state = await submit({ decision: "APPROVE", note: GOOD_NOTE });

    expect(approve.calls).toBe(0);
    expect(state.outcome).toBe("error");
  });
});

describe("the action, when it is allowed to act", () => {
  it("redirects to persistent page-level feedback after a successful decision", async () => {
    stubMe(["company.approve"]);
    watchApprove();

    await expect(
      submit({
        companyId: COMPANY_ID,
        decision: "APPROVE",
        note: GOOD_NOTE,
        returnTo: "/companies?durum=PENDING&sayfa=1",
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/companies?durum=PENDING&sayfa=1&sonuc=approved");
  });

  it("keeps a successful decision on the company object page when that is the return target", async () => {
    stubMe(["company.approve"]);
    watchApprove();

    await expect(
      submit({
        companyId: COMPANY_ID,
        decision: "APPROVE",
        note: GOOD_NOTE,
        returnTo: `/companies/${COMPANY_ID}`,
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith(`/companies/${COMPANY_ID}?sonuc=approved`);
  });

  it("rejects with the written reason and revalidates the queue", async () => {
    stubMe(["company.approve"]);
    const reject = watchReject();

    await expect(
      submit({ companyId: COMPANY_ID, decision: "REJECT", note: GOOD_NOTE }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(reject.calls).toBe(1);
    expect(reject.body).toEqual({ reason: GOOD_NOTE });
    expect(reject.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(revalidatePath).toHaveBeenCalledWith("/companies");
    expect(redirect).toHaveBeenCalledWith("/companies?sonuc=rejected");
  });

  it("accepts the current review response as success and revalidates the queue", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove(() =>
      HttpResponse.json({
        success: true,
        message: "Şirket onaylandı.",
        data: reviewCompany({
          email: null,
          phoneNumber: null,
          approvalStatus: "APPROVED",
          approvalNote: GOOD_NOTE,
          approvalDecidedAt: "2026-09-06T09:41:00Z",
          createdBy: null,
        }),
      }),
    );

    await expect(
      submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(approve.body).toEqual({ note: GOOD_NOTE });
    expect(revalidatePath).toHaveBeenCalledWith("/companies");
    expect(redirect).toHaveBeenCalledWith("/companies?sonuc=approved");
  });

  it("trims the approval note before sending it and redirects with no secret material", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    await expect(
      submit({
        companyId: COMPANY_ID,
        decision: "APPROVE",
        note: `  ${GOOD_NOTE}  `,
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(approve.calls).toBe(1);
    expect(approve.body).toEqual({ note: GOOD_NOTE });
    expect(approve.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(JSON.stringify(redirect.mock.calls)).not.toContain("ACCESS-TOKEN");
    expect(JSON.stringify(redirect.mock.calls)).not.toContain(GOOD_NOTE);
  });

  it("still redirects to success when cache revalidation fails after the mutation", async () => {
    stubMe(["company.approve"]);
    watchApprove();
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    await expect(
      submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/companies?sonuc=approved");
  });

  it("will not redirect a successful decision to an external return target", async () => {
    stubMe(["company.approve"]);
    watchApprove();

    await expect(
      submit({
        companyId: COMPANY_ID,
        decision: "APPROVE",
        note: GOOD_NOTE,
        returnTo: "https://evil.example/collect",
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(redirect).toHaveBeenCalledWith("/companies?sonuc=approved");
  });

  it("does not revalidate when the approval failed", async () => {
    stubMe(["company.approve"]);
    watchApprove(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Şirket zaten onaylanmış.",
          httpStatus: "409 CONFLICT",
          errorCode: "COMPANY_ALREADY_APPROVED",
          errorCategory: "DATA_CONFLICT",
          requestId: "rid-409",
          path: `/admin/companies/${COMPANY_ID}/approve`,
          timeStamp: "2026-09-06T09:42:00.000000000Z",
        },
        { status: 409 },
      ),
    );

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    expect(revalidatePath).not.toHaveBeenCalled();
    expect(redirect).not.toHaveBeenCalled();
    expect(state.message).toContain("sizden önce sonuçlandırılmış olabilir");
    expect(state.requestId).toBe("rid-409");
  });

  it("shows a backend refusal as the backend's", async () => {
    stubMe(["company.approve"]);
    watchApprove(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: `/admin/companies/${COMPANY_ID}/approve`,
          timeStamp: "2026-09-06T09:43:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    expect(state.message).toContain("Yetki kararını backend verir.");
  });
});
