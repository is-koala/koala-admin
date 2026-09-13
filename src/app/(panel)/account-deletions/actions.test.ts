import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const revalidatePath = vi.fn<(path: string) => void>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));

const { initialDecisionState } = await import("@/components/panel/queue/decision-state");
const { REJECTION_MIN_REASON_LENGTH } = await import("@/server/api/account-deletions");
const { submitDeletionRejection } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const REJECT = apiUrl("/admin/account-deletions/:requestId/reject");

const REQUEST_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const GOOD_NOTE = "Yasal saklama incelemesi sürüyor.";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  revalidatePath.mockReset();
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

function watchReject(respond?: () => Response) {
  const seen: { calls: number; body: unknown } = { calls: 0, body: null };

  server.use(
    http.post(REJECT, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.json();

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Hesap silme talebi reddedildi.",
        httpStatus: "200 OK",
        path: `/admin/account-deletions/${REQUEST_ID}/reject`,
        requestId: "rid-reject",
        timeStamp: "2026-09-11T08:01:00.000000000Z",
        data: {
          id: REQUEST_ID,
          subjectId: "bbbbbbbb-0000-4000-8000-000000000001",
          status: "REJECTED",
          requestedAt: "2026-09-10T08:00:00Z",
          processedAt: "2026-09-11T08:01:00Z",
          blockedReason: GOOD_NOTE,
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
  submitDeletionRejection(initialDecisionState, form(fields));

describe("the action refuses before it acts", () => {
  it("will not reject for a caller without user.deletion.manage, and sends nothing", async () => {
    stubMe(["user.read_pii"]);
    const reject = watchReject();

    const state = await submit({
      requestId: REQUEST_ID,
      decision: "REJECT",
      note: GOOD_NOTE,
    });

    expect(reject.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("Hesap silme taleplerini yönet");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("will not reject without a written reason", async () => {
    stubMe(["user.deletion.manage"]);
    const reject = watchReject();

    const state = await submit({
      requestId: REQUEST_ID,
      decision: "REJECT",
      note: "kısa",
    });

    expect(reject.calls).toBe(0);
    expect(state.field).toBe("note");
    expect(state.message).toContain(String(REJECTION_MIN_REASON_LENGTH));
  });
});

describe("the action posts the rejection", () => {
  it("sends reason in the body the backend DTO names", async () => {
    stubMe(["user.deletion.manage"]);
    const reject = watchReject();

    const state = await submit({
      requestId: REQUEST_ID,
      decision: "REJECT",
      note: GOOD_NOTE,
    });

    expect(reject.calls).toBe(1);
    expect(reject.body).toEqual({ reason: GOOD_NOTE });
    expect(state.outcome).toBe("success");
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/account-deletions/${REQUEST_ID}`,
      "/account-deletions",
      "/",
    ]);
  });

  it("does not open a second success path from a stale pending form", async () => {
    stubMe(["user.deletion.manage"]);
    watchReject();

    const first = await submit({
      requestId: REQUEST_ID,
      decision: "REJECT",
      note: GOOD_NOTE,
    });
    expect(first.outcome).toBe("success");
    expect(revalidatePath).toHaveBeenCalledWith("/account-deletions");
    revalidatePath.mockClear();

    watchReject(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Talep daha önce işlendi.",
          httpStatus: "409 CONFLICT",
          errorCode: "DELETION_ALREADY_PROCESSED",
          errorCategory: "DATA_CONFLICT",
          requestId: "rid-409-replay",
          path: `/admin/account-deletions/${REQUEST_ID}/reject`,
        },
        { status: 409 },
      ),
    );

    const second = await submit({
      requestId: REQUEST_ID,
      decision: "REJECT",
      note: GOOD_NOTE,
    });

    expect(second.outcome).toBe("error");
    expect(second.errorCode).toBe("DELETION_ALREADY_PROCESSED");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("turns a 409 into an operator sentence", async () => {
    stubMe(["user.deletion.manage"]);
    watchReject(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Talep daha önce işlendi.",
          httpStatus: "409 CONFLICT",
          errorCode: "DELETION_ALREADY_PROCESSED",
          errorCategory: "DATA_CONFLICT",
          requestId: "rid-409",
          path: `/admin/account-deletions/${REQUEST_ID}/reject`,
        },
        { status: 409 },
      ),
    );

    const state = await submit({
      requestId: REQUEST_ID,
      decision: "REJECT",
      note: GOOD_NOTE,
    });

    expect(state.outcome).toBe("error");
    expect(state.errorCode).toBe("DELETION_ALREADY_PROCESSED");
    expect(state.message).toContain("sonuçlandırılmış");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
