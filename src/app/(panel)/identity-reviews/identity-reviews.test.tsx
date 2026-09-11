import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: IdentityReviewsPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const REVIEWS = apiUrl("/admin/identity-verifications");

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const FRONT_ID = "c3000000-0000-4000-8000-000000000003";
const BACK_ID = "d4000000-0000-4000-8000-000000000004";

const REVIEWER = ["identity.review"];
const MODERATOR = ["content.moderate"];

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
  frontDocumentId: FRONT_ID,
  backDocumentId: BACK_ID,
  createdAt: "2026-09-11T12:00:00Z",
  fileUrl: "s3://koala-secret/tckk.jpg",
  storageKey: "images/tckk.jpg",
};

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["IDENTITY_REVIEWER"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watchQueue(rows: unknown[]) {
  const seen: { calls: number; url: URL | null; authorization: string | null } = {
    calls: 0,
    url: null,
    authorization: null,
  };

  server.use(
    http.get(REVIEWS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "İncelemeler listelendi.",
        httpStatus: "200 OK",
        path: "/admin/identity-verifications",
        requestId: "rid-identity",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: {
          content: rows,
          page: 0,
          size: 20,
          totalElements: rows.length,
          totalPages: rows.length === 0 ? 0 : 1,
          first: true,
          last: true,
        },
      });
    }),
  );

  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(<IdentityReviewsPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

describe("who can see the identity review queue", () => {
  it("refuses a MODERATOR and never asks the backend for reviews", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const queue = watchQueue([PENDING_REVIEW]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain("Yusuf");
  });
});

describe("TCKK photos on the review page", () => {
  it("points front and back imgs at the same-origin BFF and never at storage", async () => {
    stubMe(REVIEWER);
    const queue = watchQueue([PENDING_REVIEW]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(queue.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(queue.url?.searchParams.get("status")).toBe("PENDING");

    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${FRONT_ID}/download`,
    );
    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${BACK_ID}/download`,
    );
    expect(html).toMatch(/alt="TCKK ön yüz"/);
    expect(html).toMatch(/alt="TCKK arka yüz"/);
    expect(html).not.toContain("s3://");
    expect(html).not.toContain("/uploads/images/");
    expect(html).not.toContain("koala-backend.test");
    expect(html).not.toContain("ACCESS-TOKEN");
    expect(html).toContain("Kimliği onayla");
    expect(html).toContain("İncelemeyi reddet");
  });

  it("keeps approve and reject when a document id is missing, without an img", async () => {
    stubMe(REVIEWER);
    watchQueue([
      {
        ...PENDING_REVIEW,
        frontDocumentId: null,
        backDocumentId: null,
        fileUrl: undefined,
        storageKey: undefined,
      },
    ]);

    const html = await render();

    expect(html).not.toContain("/documents/");
    expect(html).toContain("Ön yüz fotoğrafı yok");
    expect(html).toContain("Arka yüz fotoğrafı yok");
    expect(html).toContain("Kimliği onayla");
    expect(html).toContain("İncelemeyi reddet");
  });
});
