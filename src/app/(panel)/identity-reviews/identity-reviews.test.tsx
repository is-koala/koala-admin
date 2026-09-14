import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminMeSuccessBody,
  resourceNotFoundBody,
  searchQueryTooLongBody,
} from "../../../../test/fixtures/envelopes";
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
      ara: "yusuf",
    });
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toBe(
      "/identity-reviews?durum=PENDING&ara=yusuf&sirala=createdAt%2Casc&boyut=40&sayfa=2",
    );
  });

  it("drops query keys the queue does not own from the return link", async () => {
    stubMe(REVIEWER);
    watchDetail();

    const html = await renderDetail(REVIEW_ID, { ara: "yusuf", utm: "x" });
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toBe(
      "/identity-reviews?ara=yusuf",
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

/** koala-admin#99: karar zamanı ve kararı veren zod'da vardı, çizilmiyordu. */
describe("the decision's time and author on the object page", () => {
  it("draws verifiedAt, rejectedAt and reviewedByStaffId for a decided review", async () => {
    stubMe(REVIEWER);
    watchDetail({
      ...PENDING_REVIEW,
      status: "APPROVED",
      verifiedAt: "2026-09-12T09:30:00Z",
      rejectedAt: null,
      reviewedByStaffId: "5f000000-0000-4000-8000-000000000055",
    });

    const html = await renderDetail();

    expect(html).toMatch(/Onay zamanı<\/dt><dd[^>]*>12\.09\.2026 12:30</);
    expect(html).toMatch(/Ret zamanı<\/dt><dd[^>]*>—</);
    expect(html).toMatch(
      /Kararı veren personel<\/dt><dd[^>]*><span[^>]*>5f000000-0000-4000-8000-000000000055</,
    );
  });

  it("draws rejectedAt for a rejected review and empty values while pending", async () => {
    stubMe(REVIEWER);
    watchDetail({
      ...PENDING_REVIEW,
      status: "REJECTED",
      rejectionReason: "Fotoğraf bulanık",
      rejectedAt: "2026-09-12T10:00:00Z",
      reviewedByStaffId: "5f000000-0000-4000-8000-000000000055",
    });
    const rejected = await renderDetail();
    expect(rejected).toMatch(/Ret zamanı<\/dt><dd[^>]*>12\.09\.2026 13:00</);
    expect(rejected).toMatch(/Onay zamanı<\/dt><dd[^>]*>—</);

    watchDetail(PENDING_REVIEW);
    const pending = await renderDetail();
    expect(pending).toMatch(/Onay zamanı<\/dt><dd[^>]*>—</);
    expect(pending).toMatch(/Ret zamanı<\/dt><dd[^>]*>—</);
    expect(pending).toMatch(/Kararı veren personel<\/dt><dd[^>]*><span[^>]*>—</);
  });

  it("points at the audit log filtered to this review, only for an audit.read holder", async () => {
    stubMe(REVIEWER);
    watchDetail(PENDING_REVIEW);
    const alone = await renderDetail();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...REVIEWER, "audit.read"]);
    watchDetail(PENDING_REVIEW);
    const html = await renderDetail();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${REVIEW_ID}"`);
  });
});

describe("the search box — koala-admin#94", () => {
  it("sends ara to the backend as query, next to the status, and names it in the result line", async () => {
    stubMe(REVIEWER);
    const queue = watchQueue([PENDING_REVIEW]);

    const html = await render({ ara: " yusuf ", durum: "PENDING", sayfa: "2" });

    expect(queue.url?.searchParams.get("query")).toBe("yusuf");
    expect(queue.url?.searchParams.get("status")).toBe("PENDING");
    expect(queue.url?.searchParams.get("page")).toBe("2");
    expect(html).toContain("“yusuf” için 1 inceleme bulundu.");
    expect(html).toContain('name="ara"');
    expect(html).toContain('value="yusuf"');
  });

  it("offers Temizle, which drops ara and keeps the view", async () => {
    stubMe(REVIEWER);
    watchQueue([PENDING_REVIEW]);

    const html = await render({ ara: "yusuf", durum: "APPROVED", boyut: "50" });

    expect(html).toContain(
      'href="/identity-reviews?durum=APPROVED&amp;sirala=createdAt%2Cdesc&amp;boyut=50"',
    );
    expect(html).toContain("Temizle");
  });

  it("carries ara into the object link so the return trip keeps the search", async () => {
    stubMe(REVIEWER);
    watchQueue([PENDING_REVIEW]);

    const html = await render({ ara: "yusuf" });

    expect(html).toContain(
      `/identity-reviews/${REVIEW_ID}?durum=PENDING&amp;sirala=createdAt%2Cdesc&amp;boyut=20&amp;ara=yusuf`,
    );
  });

  it("keeps ara on the pager and the status filter form, so paging or refiltering does not drop it", async () => {
    stubMe(REVIEWER);
    watchQueue([PENDING_REVIEW]);

    const html = await render({ ara: "yusuf", durum: "PENDING" });
    const container = document.createElement("div");
    container.innerHTML = html;
    const forms = [...container.querySelectorAll("form")];

    const pager = forms.find((form) => form.querySelector('button[name="sayfa"]') !== null);
    expect(pager?.querySelector<HTMLInputElement>('input[name="ara"]')?.value).toBe("yusuf");

    const filters = forms.find((form) => form.querySelector('select[name="durum"]') !== null);
    expect(filters?.querySelector<HTMLInputElement>('input[name="ara"]')?.value).toBe("yusuf");
  });

  it("says there is no result for the query once, in the empty state, not twice", async () => {
    stubMe(REVIEWER);
    watchQueue([]);

    const html = await render({ ara: "kimse" });

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html.split("“kimse” için sonuç yok.")).toHaveLength(2);
    expect(html).not.toContain('role="status"');
    expect(html).not.toContain("Bekliyor durumunda inceleme yok.");
  });

  it("shows the backend's 400 for an over-long query inline, next to the box", async () => {
    stubMe(REVIEWER);
    server.use(
      http.get(REVIEWS, () =>
        HttpResponse.json(searchQueryTooLongBody("/admin/identity-verifications"), {
          status: 400,
        }),
      ),
    );

    const html = await render({ ara: "k".repeat(120) });

    expect(html).toContain('role="alert"');
    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Kimlik kuyruğu yüklenemedi.");
  });
});

/** koala-admin#100 / koala-backend#283: kararı veren personelin adı kimliğin yanında. */
describe("the deciding staff member's name", () => {
  it("draws the name before the id when the DTO carries it", async () => {
    stubMe(REVIEWER);
    watchDetail({
      ...PENDING_REVIEW,
      status: "APPROVED",
      verifiedAt: "2026-09-12T09:30:00Z",
      reviewedByStaffId: "5f000000-0000-4000-8000-000000000055",
      reviewedByStaffName: "Zeynep Kaya",
    });

    const html = await renderDetail();

    expect(html).toMatch(
      /Kararı veren personel<\/dt><dd[^>]*><span[^>]*><span>Zeynep Kaya<\/span><span[^>]*>5f000000-0000-4000-8000-000000000055</,
    );
  });
});

/** koala-admin#112: kırıntı menüdeki adla, kuyruk görünümü geri taşınır. */
describe("the identity review's breadcrumb", () => {
  it("writes Kimlik incelemeleri › short id and links the queue with the carried view", async () => {
    stubMe(REVIEWER);
    watchDetail();

    const html = await renderDetail(REVIEW_ID, { durum: "APPROVED", boyut: "50" });

    expect(html).toContain('<nav aria-label="Konum">');
    expect(html).toContain(
      'href="/identity-reviews?durum=APPROVED&amp;boyut=50"><span class="">Kimlik incelemeleri</span></a>',
    );
    expect(html).toContain(`title="${REVIEW_ID}">${REVIEW_ID.slice(0, 8)}<`);
    expect(html).not.toContain("Kuyruğa dön");
  });
});
