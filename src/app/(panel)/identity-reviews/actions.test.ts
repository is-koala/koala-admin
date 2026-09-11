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
const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const GOOD_REASON = "Fotoğraflar okunaksız, yeniden çekilsin.";

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

function watchApprove() {
  const seen: { calls: number; body: string | null } = { calls: 0, body: null };
  server.use(
    http.post(APPROVE, async ({ request }) => {
      seen.calls += 1;
      seen.body = await request.text();
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
});
