import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

/**
 * Approving a company, treated as the irreversible POST endpoint it is.
 *
 * The refusals are what matter. There is no un-approve anywhere in
 * koala-backend, so a call that should not have happened cannot be taken back —
 * which makes "the request was never made" the only assertion worth writing.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { initialDecisionState } = await import("@/components/panel/queue/decision-state");
const { APPROVAL_MIN_NOTE_LENGTH } = await import("@/server/api/companies");
const { submitCompanyApproval } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const APPROVE = apiUrl("/admin/companies/:companyId/approve");

const COMPANY_ID = "9c000000-0000-4000-8000-000000000001";
const GOOD_NOTE = "Vergi levhası ve imza sirküleri kontrol edildi.";

let infoLines: string[] = [];

beforeEach(() => {
  infoLines = [];
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation((line: unknown) => {
    infoLines.push(String(line));
  });
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
  const seen: { calls: number; body: string | null } = { calls: 0, body: null };

  server.use(
    http.post(APPROVE, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.text();

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Şirket onaylandı.",
        httpStatus: "200 OK",
        path: `/admin/companies/${COMPANY_ID}/approve`,
        correlationId: "cid-approve",
        timeStamp: "2026-09-06T09:41:00.000000000Z",
        data: {
          id: COMPANY_ID,
          name: "Koala Kahve A.Ş.",
          email: null,
          logoUrl: null,
          phoneNumber: null,
          website: null,
          description: null,
          taxNumber: "1234567890",
          type: "CORPORATION",
          address: null,
          companyContacts: [],
          images: [],
          approved: true,
        },
      });
    }),
  );

  return seen;
}

function submit(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return submitCompanyApproval(initialDecisionState, data);
}

describe("the action refuses before it approves", () => {
  it("will not approve for a MODERATOR, and sends nothing", async () => {
    // `content.moderate` is not `company.approve`. The form living on another
    // page is not a defence; this action has its own URL.
    stubMe(["content.moderate"]);
    const approve = watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    expect(approve.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("Şirket başvurularını onayla");
  });

  it("will not approve without a written reason", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: "az" });

    expect(approve.calls).toBe(0);
    expect(state.field).toBe("note");
    expect(state.message).toContain(String(APPROVAL_MIN_NOTE_LENGTH));
  });

  it("refuses any decision other than approval, because there is no other one", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "REJECT", note: GOOD_NOTE });

    expect(approve.calls).toBe(0);
    expect(state.field).toBe("decision");
    expect(state.message).toContain("ret ya da onayı geri alma ucu yok");
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
  it("approves with no request body, because the endpoint reads none", async () => {
    stubMe(["company.approve"]);
    const approve = watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    expect(approve.calls).toBe(1);
    expect(approve.body).toBe("");
    expect(state.outcome).toBe("success");
    expect(state.message).toContain("ilan yayınlayabilir");
  });

  it("tells the operator their reason did not reach the backend", async () => {
    // The note is required by the panel and has nowhere to go on the backend.
    // Saying so is the difference between a rule and a pretence.
    stubMe(["company.approve"]);
    watchApprove();

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    expect(state.message).toContain("Gerekçeniz backend'e gönderilmedi");
    expect(state.message).toContain("bildirim gitmez");
  });

  it("writes the reason to the server log, marked as not sent", async () => {
    // A stopgap until koala-backend#15, and not an audit mechanism: one line,
    // stored nowhere, queryable from nothing in this panel.
    stubMe(["company.approve"]);
    watchApprove();

    await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    const line = infoLines.find((entry) => entry.startsWith("[company-approval]"));
    expect(line).toContain(COMPANY_ID);
    expect(line).toContain(GOOD_NOTE);
    expect(line).toContain("sentToBackend=false");
  });

  it("logs nothing when the approval failed", async () => {
    stubMe(["company.approve"]);
    watchApprove(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Şirket zaten onaylanmış.",
          httpStatus: "409 CONFLICT",
          errorCode: "COMPANY_ALREADY_APPROVED",
          errorCategory: "DATA_CONFLICT",
          correlationId: "cid-409",
          path: `/admin/companies/${COMPANY_ID}/approve`,
          timeStamp: "2026-09-06T09:42:00.000000000Z",
        },
        { status: 409 },
      ),
    );

    const state = await submit({ companyId: COMPANY_ID, decision: "APPROVE", note: GOOD_NOTE });

    expect(infoLines.some((entry) => entry.startsWith("[company-approval]"))).toBe(false);
    expect(state.message).toContain("sizden önce sonuçlandırılmış olabilir");
    expect(state.correlationId).toBe("cid-409");
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
          correlationId: "cid-403",
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
