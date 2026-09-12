import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

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
const { submitIdentityReviewDecision } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const APPROVE = apiUrl("/admin/identity-verifications/:reviewId/approve");
const REJECT = apiUrl("/admin/identity-verifications/:reviewId/reject");
const REVIEW = apiUrl("/admin/identity-verifications/:reviewId");
const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const GOOD_REASON = "Fotoğraflar okunaksız, yeniden çekilsin.";

const PENDING_REVIEW = {
  id: REVIEW_ID,
  userId: "b2000000-0000-4000-8000-000000000002",
  firstName: "Yusuf",
  lastName: "Acmaci",
  tcIdentityNumber: "10000000146",
  tcDocumentNumber: "A01A00000",
  birthDate: "1998-04-12",
  status: "PENDING",
  rejectionReason: null,
  rejectedAt: null,
  verifiedAt: null,
  reviewedByStaffId: null,
  selfieDocumentId: "e5000000-0000-4000-8000-000000000005",
  frontDocumentId: "c3000000-0000-4000-8000-000000000003",
  backDocumentId: "d4000000-0000-4000-8000-000000000004",
  togetherDocumentId: "f6000000-0000-4000-8000-000000000006",
  createdAt: "2026-09-11T12:00:00Z",
};

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
  const seen: { calls: number; body: string | null } = { calls: 0, body: null };
  server.use(
    http.post(APPROVE, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.text();
      if (respond !== undefined) return respond();
      return HttpResponse.json({
        success: true,
        message: "Kimlik onaylandı.",
        data: { id: REVIEW_ID, status: "APPROVED" },
      });
    }),
  );
  return seen;
}

function watchReject() {
  const seen: { calls: number; body: unknown } = { calls: 0, body: null };
  server.use(
    http.post(REJECT, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.json();
      return HttpResponse.json({
        success: true,
        message: "İnceleme reddedildi.",
        data: { id: REVIEW_ID, status: "REJECTED" },
      });
    }),
  );
  return seen;
}

function watchReview(row: unknown = PENDING_REVIEW) {
  const seen: { calls: number } = { calls: 0 };
  server.use(
    http.get(REVIEW, () => {
      seen.calls += 1;
      return HttpResponse.json({
        success: true,
        message: "Kimlik incelemesi getirildi.",
        httpStatus: "200 OK",
        path: `/admin/identity-verifications/${REVIEW_ID}`,
        requestId: "rid-identity-one",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: row,
      });
    }),
  );
  return seen;
}

function submit(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return submitIdentityReviewDecision(initialDecisionState, data);
}

describe("identity review decisions", () => {
  it("sends nothing when the actor lacks identity.review", async () => {
    stubMe(["content.moderate"]);
    const approve = watchApprove();
    const reject = watchReject();

    const state = await submit({ reviewId: REVIEW_ID, decision: "APPROVE" });

    expect(approve.calls).toBe(0);
    expect(reject.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("Kimlik belgelerini incele");
  });

  it("approves without inventing a note body", async () => {
    stubMe(["identity.review"]);
    watchReview();
    const approve = watchApprove();

    await expect(
      submit({
        reviewId: REVIEW_ID,
        decision: "APPROVE",
        returnTo: "/identity-reviews?durum=PENDING",
      }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(approve.calls).toBe(1);
    expect(approve.body).toBe("");
    expect(redirect).toHaveBeenCalledWith("/identity-reviews?durum=PENDING&sonuc=approved");
  });

  it("rejects with the written reason and keeps a short reason away from the backend", async () => {
    stubMe(["identity.review"]);
    const reject = watchReject();

    const short = await submit({ reviewId: REVIEW_ID, decision: "REJECT", reason: "az" });
    expect(reject.calls).toBe(0);
    expect(short.field).toBe("reason");

    await expect(
      submit({ reviewId: REVIEW_ID, decision: "REJECT", reason: GOOD_REASON }),
    ).rejects.toThrow("NEXT_REDIRECT");

    expect(reject.calls).toBe(1);
    expect(reject.body).toEqual({ reason: GOOD_REASON });
  });

  it("does not approve a forged request whose review is missing a document", async () => {
    stubMe(["identity.review"]);
    const approve = watchApprove();
    watchReview({ ...PENDING_REVIEW, togetherDocumentId: null });

    const state = await submit({ reviewId: REVIEW_ID, decision: "APPROVE" });

    expect(approve.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("Dört TCKK fotoğrafı");
  });

  it("does not approve a review that is no longer PENDING", async () => {
    stubMe(["identity.review"]);
    const approve = watchApprove();
    watchReview({ ...PENDING_REVIEW, status: "APPROVED" });

    const state = await submit({ reviewId: REVIEW_ID, decision: "APPROVE" });

    expect(approve.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("bekleyen durumda değil");
  });

  it("shows a backend 403 as a Turkish refusal", async () => {
    stubMe(["identity.review"]);
    watchReview();
    watchApprove(() =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: `/admin/identity-verifications/${REVIEW_ID}/approve`,
          timeStamp: "2026-09-11T12:03:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const state = await submit({ reviewId: REVIEW_ID, decision: "APPROVE" });

    expect(state.outcome).toBe("error");
    expect(state.message).toContain("Yetki kararını backend verir.");
    expect(state.message).toContain("Bu işlem için yetkiniz yok.");
  });

  it("shows a missing-document conflict as the four-photo rule, not as someone else's decision", async () => {
    stubMe(["identity.review"]);
    watchReview();
    watchApprove(() =>
      HttpResponse.json(
        {
          success: false,
          message:
            "Onay için dört fotoğraf da gerekli: yüz, TCKK ön, TCKK arka ve TCKK yüzün altında. Eksik kanıtla onaylanamaz; incelemeyi reddedin, kullanıcı dört fotoğrafı tekrar yüklesin.",
          httpStatus: "409 CONFLICT",
          errorCode: "IDENTITY_REVIEW_DOCUMENTS_MISSING",
          errorCategory: "DATA_CONFLICT",
          requestId: "rid-docs",
          path: `/admin/identity-verifications/${REVIEW_ID}/approve`,
          timeStamp: "2026-09-11T12:04:00.000000000Z",
        },
        { status: 409 },
      ),
    );

    const state = await submit({ reviewId: REVIEW_ID, decision: "APPROVE" });

    expect(state.outcome).toBe("error");
    expect(state.message).toContain("dört fotoğraf da gerekli");
    expect(state.message).not.toContain("sizden önce sonuçlandırılmış");
    expect(state.errorCode).toBe("IDENTITY_REVIEW_DOCUMENTS_MISSING");
  });
});
