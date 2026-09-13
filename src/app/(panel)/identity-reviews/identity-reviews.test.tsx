import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody, resourceNotFoundBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: IdentityReviewsPage } = await import("./page");
const { default: IdentityReviewDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const REVIEWS = apiUrl("/admin/identity-verifications");

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const SELFIE_ID = "e5000000-0000-4000-8000-000000000005";
const FRONT_ID = "c3000000-0000-4000-8000-000000000003";
const BACK_ID = "d4000000-0000-4000-8000-000000000004";
const TOGETHER_ID = "f6000000-0000-4000-8000-000000000006";

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
  selfieDocumentId: SELFIE_ID,
  frontDocumentId: FRONT_ID,
  backDocumentId: BACK_ID,
  togetherDocumentId: TOGETHER_ID,
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

function watchDetail(row: unknown = PENDING_REVIEW, respond?: () => Response) {
  const seen: { calls: number; reviewId: string | null } = {
    calls: 0,
    reviewId: null,
  };

  server.use(
    http.get(`${REVIEWS}/:reviewId`, ({ params }) => {
      seen.calls += 1;
      seen.reviewId = String(params.reviewId);

      if (respond !== undefined) return respond();

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

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(<IdentityReviewsPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

const renderDetail = async (id: string = REVIEW_ID, query: Record<string, string> = {}) =>
  (
    await renderServerComponent(
      <IdentityReviewDetailPage
        params={Promise.resolve({ id })}
        searchParams={Promise.resolve(query)}
      />,
    )
  ).replaceAll("<!-- -->", "");

/** Onayın gerçekten gönderilebilir olup olmadığı — kapalı diyalogdaki submit de sayılır. */
function enabledApproveControls(html: string): HTMLButtonElement[] {
  const container = document.createElement("div");
  container.innerHTML = html;
  return [...container.querySelectorAll("button")].filter((button): button is HTMLButtonElement => {
    if (!(button instanceof HTMLButtonElement)) return false;
    if (!(button.textContent ?? "").includes("Kimliği onayla")) return false;
    return !button.disabled;
  });
}

describe("who can see the identity review queue", () => {
  it("refuses a MODERATOR and never asks the backend for reviews", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const queue = watchQueue([PENDING_REVIEW]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain("Yusuf");
  });

  it("refuses a MODERATOR on the object page and never asks GET by id", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const detail = watchDetail();

    const html = await renderDetail();

    expect(detail.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain("Yusuf");
  });
});

describe("the queue is not the review", () => {
  it("links each row to the object page and does not inline the decision form", async () => {
    stubMe(REVIEWER);
    const detail = watchDetail();
    const queue = watchQueue([PENDING_REVIEW]);

    const html = await render({
      durum: "PENDING",
      sirala: "createdAt,desc",
      boyut: "20",
      sayfa: "0",
    });

    expect(queue.calls).toBe(1);
    expect(queue.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(detail.calls).toBe(0);
    expect(html).toContain(`/identity-reviews/${REVIEW_ID}?`);
    expect(html).toContain("durum=PENDING");
    expect(html).toContain(`/users/${PENDING_REVIEW.userId}`);
    expect(html).toContain("İncele");
    expect(html).not.toContain("Kimliği onayla");
    expect(html).not.toContain("İncelemeyi reddet");
    expect(html).not.toContain("/api/identity-verifications/");
    expect(html).not.toContain("s3://");
    expect(html).not.toContain("ACCESS-TOKEN");
  });
});

describe("TCKK photos on the object page", () => {
  it("points all four imgs at the same-origin BFF and never at storage", async () => {
    stubMe(REVIEWER);
    watchDetail(PENDING_REVIEW);

    const html = await renderDetail();

    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${SELFIE_ID}/download`,
    );
    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${FRONT_ID}/download`,
    );
    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${BACK_ID}/download`,
    );
    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${TOGETHER_ID}/download`,
    );
    expect(html).toContain("Yüz");
    expect(html).toContain("TCKK ön");
    expect(html).toContain("TCKK arka");
    expect(html).toContain("TCKK yüzün altında");
    expect(html).toMatch(/alt="Yüz fotoğrafı"/);
    expect(html).toMatch(/alt="TCKK ön yüz"/);
    expect(html).toMatch(/alt="TCKK arka yüz"/);
    expect(html).toMatch(/alt="TCKK yüzün altında"/);
    expect(html).not.toContain("s3://");
    expect(html).not.toContain("/uploads/images/");
    expect(html).not.toContain("koala-backend.test");
    expect(html).not.toContain("ACCESS-TOKEN");
    // vitest.config.mts listeyi dolu verir; uyarı yalnız boş listede çıkar
    // (src/server/evidence/signed-download-notice.test.tsx).
    expect(html).not.toContain("İmzalı indirme kaynakları tanımlı değil");
    expect(html).toContain("Kimliği onayla");
    expect(enabledApproveControls(html)).toHaveLength(1);
    expect(html).toContain("İncelemeyi reddet");
    expect(html).toContain(`/users/${PENDING_REVIEW.userId}`);
  });

  it("closes approve and leaves reject when the four document ids are missing", async () => {
    stubMe(REVIEWER);
    watchDetail({
      ...PENDING_REVIEW,
      selfieDocumentId: null,
      frontDocumentId: null,
      backDocumentId: null,
      togetherDocumentId: null,
      fileUrl: undefined,
      storageKey: undefined,
    });

    const html = await renderDetail();

    expect(html).not.toContain("/documents/");
    expect(html).toContain("Yüz fotoğrafı yok");
    expect(html).toContain("TCKK ön fotoğrafı yok");
    expect(html).toContain("TCKK arka fotoğrafı yok");
    expect(html).toContain("TCKK yüzün altında fotoğrafı yok");
    expect(enabledApproveControls(html)).toHaveLength(0);
    expect(html).toContain("İncelemeyi reddet");
  });

  it("closes approve when only the TCKK-under-face document is missing", async () => {
    stubMe(REVIEWER);
    watchDetail({ ...PENDING_REVIEW, togetherDocumentId: null });

    const html = await renderDetail();

    expect(html).toContain("TCKK yüzün altında fotoğrafı yok");
    expect(html).toContain(
      `/api/identity-verifications/${REVIEW_ID}/documents/${SELFIE_ID}/download`,
    );
    expect(enabledApproveControls(html)).toHaveLength(0);
    expect(html).toContain("İncelemeyi reddet");
  });

  it("returns a successful decision to the identity queue, carrying the view the operator left", async () => {
    stubMe(REVIEWER);
    watchDetail();

    const html = await renderDetail(REVIEW_ID, {
      durum: "PENDING",
      sirala: "createdAt,asc",
      boyut: "40",
      sayfa: "2",
    });
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toBe(
      "/identity-reviews?durum=PENDING&sirala=createdAt%2Casc&boyut=40&sayfa=2",
    );
  });
});

/**
 * koala-admin#85. Backend'de olmayan bir inceleme, uyarı kutusunda açıklanacak
 * bir yükleme hatası değil; hiçbir kaydı adreslemeyen bir adres, ve bunu
 * söyleyen tek yer ortak `not-found.tsx`. `notFound()` fırlattığı için render
 * reddeder — Next onu digest'ten tanır.
 */
describe("a review that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND rather than drawing an alert", async () => {
    stubMe(REVIEWER);
    const detail = watchDetail(undefined, () =>
      HttpResponse.json(
        {
          ...resourceNotFoundBody,
          errorCode: "IDENTITY_VERIFICATION_NOT_FOUND",
          path: `/admin/identity-verifications/${REVIEW_ID}`,
        },
        { status: 404 },
      ),
    );

    const thrown = await renderDetail().then(
      () => null,
      (error: unknown) => error,
    );

    expect(detail.calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(REVIEWER);
    const detail = watchDetail();

    const thrown = await renderDetail("not-a-uuid").then(
      () => null,
      (error: unknown) => error,
    );

    expect(detail.calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
