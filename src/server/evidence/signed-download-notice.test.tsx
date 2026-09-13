import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_REVIEW_ID, reviewCompany } from "../../../test/fixtures/companies";
import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

/**
 * `src/env.ts` import anında `process.env`'den okur; vitest.config.mts listeyi
 * dolu verir. Boş listeyi bu dosya kendi seçer, gerisi gerçek env.
 */
const allowlist = vi.hoisted(() => ({ origins: [] as string[] }));

vi.mock("@/env", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/env")>();
  return {
    ...actual,
    env: {
      ...actual.env,
      get EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS() {
        return allowlist.origins;
      },
    },
  };
});

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { SignedDownloadAllowlistNotice } = await import("./signed-download-notice");
const { default: IdentityReviewDetailPage } =
  await import("@/app/(panel)/identity-reviews/[id]/page");
const { default: CompanyDetailPage } = await import("@/app/(panel)/companies/[id]/page");
const { default: DisputeDetailPage } = await import("@/app/(panel)/disputes/[id]/page");

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const DISPUTE_ID = "d1000000-0000-4c00-8000-000000000001";
const NOTICE = "İmzalı indirme kaynakları tanımlı değil";

beforeEach(() => {
  allowlist.origins = [];
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(apiUrl("/admin/me"), () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: ["REVIEWER"], permissions },
      }),
    ),
  );
}

function envelope(path: string, data: unknown) {
  return HttpResponse.json({
    success: true,
    message: "Getirildi.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-notice",
    timeStamp: "2026-09-13T12:00:00.000000000Z",
    data,
  });
}

function stubCompany() {
  server.use(
    http.get(apiUrl(`/admin/companies/${COMPANY_REVIEW_ID}`), () =>
      envelope(`/admin/companies/${COMPANY_REVIEW_ID}`, reviewCompany()),
    ),
  );
}

function stubDispute() {
  server.use(
    http.get(apiUrl(`/admin/disputes/${DISPUTE_ID}`), () =>
      envelope(`/admin/disputes/${DISPUTE_ID}`, {
        id: DISPUTE_ID,
        jobAssignmentId: "9a1c0f10-0001-4c00-8000-0000000000aa",
        openedBy: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
        status: "OPEN",
        reason: "Vardiyayı tamamladım.",
        resolution: null,
        resolutionNote: null,
        resolvedAt: null,
        createdAt: "2026-09-05T08:00:00.000000000Z",
      }),
    ),
    http.get(apiUrl(`/admin/disputes/${DISPUTE_ID}/evidence`), () =>
      envelope(`/admin/disputes/${DISPUTE_ID}/evidence`, []),
    ),
  );
}

function stubReview() {
  server.use(
    http.get(apiUrl(`/admin/identity-verifications/${REVIEW_ID}`), () =>
      HttpResponse.json({
        success: true,
        message: "Kimlik incelemesi getirildi.",
        httpStatus: "200 OK",
        path: `/admin/identity-verifications/${REVIEW_ID}`,
        requestId: "rid-identity-one",
        timeStamp: "2026-09-13T12:00:00.000000000Z",
        data: {
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
        },
      }),
    ),
  );
}

const renderDetail = () =>
  renderServerComponent(
    <IdentityReviewDetailPage
      params={Promise.resolve({ id: REVIEW_ID })}
      searchParams={Promise.resolve({})}
    />,
  );

describe("SignedDownloadAllowlistNotice", () => {
  it("names the env key when the allowlist is empty", async () => {
    const html = await renderServerComponent(
      <SignedDownloadAllowlistNotice subject="TCKK fotoğrafları" />,
    );

    expect(html).toContain(NOTICE);
    expect(html).toContain("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
    expect(html).toContain("TCKK fotoğrafları");
    expect(html).toContain("docs/evidence-download-origins.md");
    expect(html).toContain('role="alert"');
  });

  it("renders nothing once at least one origin is configured", async () => {
    allowlist.origins = ["https://storage.koala.test"];

    const html = await renderServerComponent(
      <SignedDownloadAllowlistNotice subject="TCKK fotoğrafları" />,
    );

    expect(html).toBe("");
  });
});

describe("the identity review page with an empty allowlist", () => {
  it("warns the reviewer at the top and still draws the photo boxes", async () => {
    stubMe(["identity.review"]);
    stubReview();

    const html = await renderDetail();

    expect(html).toContain(NOTICE);
    // Yerel depolama 200 ile doğrudan akıtır; boş liste orada meşru, kutular
    // denemeye devam eder.
    expect(html).toContain(`/api/identity-verifications/${REVIEW_ID}/documents/`);
    expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf("TCKK fotoğrafları</h3>"));
  });

  it("keeps the warning behind the permission gate", async () => {
    stubMe(["content.moderate"]);
    stubReview();

    const html = await renderDetail();

    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain(NOTICE);
  });
});

describe("the other two download surfaces with an empty allowlist", () => {
  it("warns on the company page above the gallery", async () => {
    stubMe(["company.approve"]);
    stubCompany();

    const html = await renderServerComponent(
      <CompanyDetailPage
        params={Promise.resolve({ id: COMPANY_REVIEW_ID })}
        searchParams={Promise.resolve({})}
      />,
    );

    expect(html).toContain(NOTICE);
    expect(html).toContain("Galeri fotoğrafları");
    expect(html).toContain(`/api/companies/${COMPANY_REVIEW_ID}/images/`);
    expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf("Galeri</dt>"));
  });

  it("warns on the dispute page above the evidence list", async () => {
    // payment.read yok: emanet özeti istenmez, sayfa yine açılır.
    stubMe(["dispute.resolve"]);
    stubDispute();

    const html = await renderServerComponent(
      <DisputeDetailPage params={Promise.resolve({ id: DISPUTE_ID })} />,
    );

    expect(html).toContain(NOTICE);
    expect(html).toContain("Kanıt dosyaları");
    expect(html.indexOf(NOTICE)).toBeLessThan(html.indexOf("Kanıt dosyaları</h3>"));
  });
});
