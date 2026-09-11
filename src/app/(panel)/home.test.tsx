import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditPageBody, categoryCreatedEntry } from "../../../test/fixtures/audit-log";
import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  requireStaffSession: () => Promise.resolve(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { default: PanelHomePage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["TRUST_LEAD"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function emptyPage(totalElements: number) {
  return {
    content: [],
    page: 0,
    size: 1,
    totalElements,
    totalPages: totalElements === 0 ? 0 : 1,
    first: true,
    last: true,
  };
}

function watchQueues() {
  const seen: string[] = [];
  server.use(
    http.get(apiUrl("/admin/identity-verifications"), ({ request }) => {
      seen.push(`identity:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/identity-verifications",
        requestId: "rid-id",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(4),
      });
    }),
    http.get(apiUrl("/admin/reports"), ({ request }) => {
      seen.push(`reports:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/reports",
        requestId: "rid-rep",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(7),
      });
    }),
    http.get(apiUrl("/admin/companies"), ({ request }) => {
      seen.push(`companies:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/companies",
        requestId: "rid-co",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(2),
      });
    }),
    http.get(apiUrl("/admin/disputes"), () => {
      seen.push("disputes");
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/disputes",
        requestId: "rid-d",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(3),
      });
    }),
    http.get(apiUrl("/admin/bank-account-verifications"), ({ request }) => {
      seen.push(`iban:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/bank-account-verifications",
        requestId: "rid-iban",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(5),
      });
    }),
    http.get(apiUrl("/admin/account-deletions"), ({ request }) => {
      seen.push(`deletions:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/account-deletions",
        requestId: "rid-del",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(1),
      });
    }),
    http.get(apiUrl("/admin/finance/summary"), () => {
      seen.push("finance");
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/finance/summary",
        requestId: "rid-fin",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: {
          from: "2026-02-28T21:00:00Z",
          to: "2026-03-31T21:00:00Z",
          currency: "TRY",
          employerVolume: "1075.00",
          koalaFee: "75.00",
          workerPayout: "1000.00",
          succeededPaymentCount: 1,
          completedPayoutAmount: "1000.00",
          completedPayoutCount: 1,
          awaitingPayoutAmount: "400.00",
          awaitingPayoutCount: 1,
        },
      });
    }),
    http.get(apiUrl("/admin/audit-log"), () => {
      seen.push("audit");
      return HttpResponse.json(auditPageBody({ content: [categoryCreatedEntry], size: 8 }));
    }),
  );
  return seen;
}

const render = async () =>
  (await renderServerComponent(<PanelHomePage />)).replaceAll("<!-- -->", "");

describe("Güncel durum", () => {
  it("shows live queue counts for the permissions the actor holds and never advertises the verification page", async () => {
    stubMe(["identity.review", "content.moderate", "company.approve", "dispute.resolve"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(
      expect.arrayContaining(["identity:PENDING", "reports:OPEN", "companies:PENDING", "disputes"]),
    );
    expect(html).toContain("Kimlik incelemeleri");
    expect(html).toContain("4");
    expect(html).toContain("Şikayetler");
    expect(html).toContain("7");
    expect(html).toContain("Şirket onayları");
    expect(html).toContain("2");
    expect(html).toContain("Uyuşmazlıklar");
    expect(html).toContain("3");
    expect(html).toContain('href="/identity-reviews"');
    expect(html).not.toContain("İş kategorileri (doğrulama)");
    expect(html).not.toContain("/verification/job-categories");
    expect(html).not.toContain("ACCESS-TOKEN");
  });

  it("does not ask queues the actor cannot open", async () => {
    stubMe(["content.moderate"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(["reports:OPEN"]);
    expect(html).toContain("Şikayetler");
    expect(html).not.toContain("Kimlik incelemeleri");
    expect(html).not.toContain("Uyuşmazlıklar");
    expect(html).not.toContain("IBAN doğrulama");
    expect(html).not.toContain("Hesap silme");
    expect(html).not.toContain("Finans");
    expect(html).not.toContain("Katalog Editörü");
  });

  it("adds IBAN and account-deletion queues when those permissions are held", async () => {
    stubMe(["bank.account.verify", "user.read_pii"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(expect.arrayContaining(["iban:PENDING", "deletions:REQUESTED"]));
    expect(html).toContain("IBAN doğrulama");
    expect(html).toContain("5");
    expect(html).toContain("Hesap silme");
    expect(html).toContain('href="/iban-verifications"');
    expect(html).toContain('href="/account-deletions"');
  });

  it("shows identity queue age from the oldest pending row", async () => {
    stubMe(["identity.review"]);
    server.use(
      http.get(apiUrl("/admin/identity-verifications"), () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/identity-verifications",
          requestId: "rid-id",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: {
            content: [
              {
                id: "a1000000-0000-4000-8000-000000000001",
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
                frontDocumentId: null,
                backDocumentId: null,
                createdAt: "2026-08-11T09:00:00.000Z",
              },
            ],
            page: 0,
            size: 1,
            totalElements: 4,
            totalPages: 4,
            first: true,
            last: false,
          },
        }),
      ),
    );

    const html = await render();

    expect(html).toContain("Kimlik incelemeleri");
    expect(html).toContain("4");
    expect(html).toContain("En eski 11.08.2026");
  });

  it("shows period finance totals and recent audit without listing every permission", async () => {
    stubMe(["finance.read", "audit.read"], ["OWNER"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(expect.arrayContaining(["finance", "audit"]));
    expect(html).toContain("Tahsilat");
    expect(html).toContain("Son işlemler");
    expect(html).toContain("Katalog Editörü");
    expect(html).toContain("job.category.create");
    expect(html).not.toContain("Etkin izinler");
    expect(html).not.toContain("finance.read");
  });
});
