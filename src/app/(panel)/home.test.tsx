import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auditPageBody, categoryCreatedEntry } from "../../../test/fixtures/audit-log";
import { reviewCompany } from "../../../test/fixtures/companies";
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

function reportRow(status: string, createdAt: string, id: string) {
  return {
    id,
    reporter: null,
    reportedUser: null,
    reportedUserId: null,
    jobId: null,
    messageId: null,
    imageId: null,
    reason: "SPAM",
    description: null,
    status,
    reviewedBy: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt,
    reportedUserReportCount: 0,
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
      const status = new URL(request.url).searchParams.get("status");
      seen.push(`reports:${status}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/reports",
        requestId: "rid-rep",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(status === "UNDER_REVIEW" ? 0 : 7),
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
    http.get(apiUrl("/admin/payouts"), ({ request }) => {
      seen.push(`payouts:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/payouts",
        requestId: "rid-payouts",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(6),
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
          stuckPaymentCount: 2,
          overduePayoutCount: 3,
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

    expect(seen).toEqual(expect.arrayContaining(["reports:OPEN", "reports:UNDER_REVIEW"]));
    expect(seen).toHaveLength(2);
    expect(html).toContain("Şikayetler");
    expect(html).not.toContain("Kimlik incelemeleri");
    expect(html).not.toContain("Uyuşmazlıklar");
    expect(html).not.toContain("IBAN doğrulama");
    expect(html).not.toContain("Hesap silme");
    expect(html).not.toContain("Hakediş mutabakatı");
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

  it("shows a PROCESSING payout reconciliation tile only for payout.reconcile", async () => {
    stubMe(["payout.reconcile"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(["payouts:PROCESSING"]);
    expect(html).toContain("Hakediş mutabakatı");
    expect(html).toContain("6");
    expect(html).toContain('href="/payout-reconciliation"');
  });

  it("counts OPEN and UNDER_REVIEW reports together so in-review complaints stay visible", async () => {
    stubMe(["content.moderate"]);
    const seen: string[] = [];
    server.use(
      http.get(apiUrl("/admin/reports"), ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        seen.push(`reports:${status}`);
        const totalElements = status === "OPEN" ? 3 : status === "UNDER_REVIEW" ? 4 : 0;
        return HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/reports",
          requestId: "rid-rep",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: emptyPage(totalElements),
        });
      }),
    );

    const html = await render();

    expect(seen).toEqual(expect.arrayContaining(["reports:OPEN", "reports:UNDER_REVIEW"]));
    expect(html).toContain("Şikayetler");
    expect(html).toContain("7");
  });

  it("shows a Turkish load error and retry hint instead of a zero when one queue fails", async () => {
    stubMe(["identity.review", "content.moderate"]);
    watchQueues();
    server.use(http.get(apiUrl("/admin/reports"), () => HttpResponse.error()));

    const html = await render();

    expect(html).toContain("Kimlik incelemeleri");
    expect(html).toContain("4");
    expect(html).toContain("Şikayetler");
    expect(html).toContain("Şikayetler yüklenemedi.");
    expect(html).toContain("Sayfayı yenileyerek yeniden deneyin.");
    expect(html).not.toContain("Şikayetler</span></span>0");
  });

  it("fails the reports tile closed when UNDER_REVIEW cannot be loaded", async () => {
    stubMe(["content.moderate"]);
    server.use(
      http.get(apiUrl("/admin/reports"), ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        if (status === "UNDER_REVIEW") {
          return HttpResponse.error();
        }
        return HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/reports",
          requestId: "rid-rep",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: emptyPage(3),
        });
      }),
    );

    const html = await render();

    expect(html).toContain("Şikayetler yüklenemedi.");
    expect(html).toContain("Sayfayı yenileyerek yeniden deneyin.");
    expect(html).not.toContain(">3<");
  });

  it("shows a zero count when a queue is empty rather than a load error", async () => {
    stubMe(["payout.reconcile"]);
    server.use(
      http.get(apiUrl("/admin/payouts"), () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/payouts",
          requestId: "rid-payouts",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: emptyPage(0),
        }),
      ),
    );

    const html = await render();

    expect(html).toContain("Hakediş mutabakatı");
    expect(html).toContain("0");
    expect(html).not.toContain("yüklenemedi");
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
                selfieDocumentId: null,
                frontDocumentId: null,
                backDocumentId: null,
                togetherDocumentId: null,
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

  it("shows report queue age from the older of OPEN and UNDER_REVIEW", async () => {
    stubMe(["content.moderate"]);
    server.use(
      http.get(apiUrl("/admin/reports"), ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        const row =
          status === "UNDER_REVIEW"
            ? reportRow(
                "UNDER_REVIEW",
                "2026-07-01T09:00:00.000Z",
                "22222222-2222-4222-8222-222222222222",
              )
            : reportRow("OPEN", "2026-08-11T09:00:00.000Z", "11111111-1111-4111-8111-111111111111");
        return HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/reports",
          requestId: "rid-rep",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: {
            content: [row],
            page: 0,
            size: 1,
            totalElements: 1,
            totalPages: 1,
            first: true,
            last: true,
          },
        });
      }),
    );

    const html = await render();

    expect(html).toContain("Şikayetler");
    expect(html).toContain("2");
    expect(html).toContain("En eski 01.07.2026");
    expect(html).not.toContain("En eski 11.08.2026");
  });

  it("shows payout queue age from the oldest PROCESSING row", async () => {
    stubMe(["payout.reconcile"]);
    server.use(
      http.get(apiUrl("/admin/payouts"), () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/payouts",
          requestId: "rid-payouts",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: {
            content: [
              {
                id: "9c000000-0000-4000-8000-000000000033",
                jobAssignmentId: "8c000000-0000-4000-8000-000000000034",
                amount: "100.00",
                currency: "TRY",
                status: "PROCESSING",
                failureReason: null,
                completedAt: null,
                createdAt: "2026-08-11T09:00:00.000Z",
              },
            ],
            page: 0,
            size: 1,
            totalElements: 2,
            totalPages: 2,
            first: true,
            last: false,
          },
        }),
      ),
    );

    const html = await render();

    expect(html).toContain("Hakediş mutabakatı");
    expect(html).toContain("2");
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

/** koala-admin#111: SLA eşiği, alarm karoları ve kaldırılan "Ekranlar" bölümü. */
function hoursAgo(hours: number): string {
  return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function pageOf(content: readonly unknown[], totalElements = content.length) {
  return {
    content,
    page: 0,
    size: 50,
    totalElements,
    totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / 50),
    first: true,
    last: totalElements <= content.length,
  };
}

function financeBody(data: Record<string, unknown>) {
  return {
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
      ...data,
    },
  };
}

describe("the SLA threshold on queue tiles", () => {
  it("asks the oldest 50 rows, counts the ones past 48 hours in red and links the aged list", async () => {
    stubMe(["payout.reconcile"]);
    let seenUrl: URL | null = null;
    server.use(
      http.get(apiUrl("/admin/payouts"), ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/payouts",
          requestId: "rid-payouts",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: pageOf(
            [hoursAgo(80), hoursAgo(50), hoursAgo(3)].map((createdAt, index) => ({
              id: `9c000000-0000-4000-8000-00000000003${index}`,
              jobAssignmentId: "8c000000-0000-4000-8000-000000000034",
              amount: "100.00",
              currency: "TRY",
              status: "PROCESSING",
              failureReason: null,
              completedAt: null,
              createdAt,
            })),
          ),
        });
      }),
    );

    const html = await render();

    expect(seenUrl).not.toBeNull();
    expect(seenUrl!.searchParams.get("size")).toBe("50");
    expect(seenUrl!.searchParams.get("sort")).toBe("createdAt,asc");
    expect(html).toContain('data-testid="queue-tile-payout-reconciliation"');
    expect(html).toMatch(
      /<a data-testid="queue-tile-overdue" class="[^"]*text-danger" href="\/payout-reconciliation\?sirala=createdAt%2Casc">2 kayıt 48 saati aştı<\/a>/,
    );
    expect(html).toContain('href="/payout-reconciliation"');
  });

  it("writes a quiet zero when nothing is past the threshold", async () => {
    stubMe(["identity.review"]);
    watchQueues();

    const html = await render();

    expect(html).toMatch(
      /text-success" href="\/identity-reviews\?sirala=createdAt%2Casc">0 kayıt 48 saati aştı</,
    );
    expect(html).not.toContain("text-danger");
  });

  it("says 50+ when the whole ascending sample is overdue and the queue is larger", async () => {
    stubMe(["company.approve"]);
    server.use(
      http.get(apiUrl("/admin/companies"), () =>
        HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/companies",
          requestId: "rid-co",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: pageOf(
            Array.from({ length: 50 }, (_, index) =>
              reviewCompany({
                id: `c${String(index).padStart(7, "0")}-0000-4000-8000-000000000001`,
                createdAt: hoursAgo(200 - index),
              }),
            ),
            120,
          ),
        }),
      ),
    );

    const html = await render();

    expect(html).toContain("120");
    expect(html).toContain("50+ kayıt 48 saati aştı");
    expect(html).toContain('href="/companies?sirala=createdAt%2Casc"');
  });

  it("counts disputes exactly from the newest-first page the backend returns", async () => {
    stubMe(["dispute.resolve"]);
    let seenUrl: URL | null = null;
    server.use(
      http.get(apiUrl("/admin/disputes"), ({ request }) => {
        seenUrl = new URL(request.url);
        return HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/disputes",
          requestId: "rid-d",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: pageOf(
            [hoursAgo(1), hoursAgo(60)].map((createdAt, index) => ({
              id: `d100000${index}-0000-4000-8000-000000000001`,
              jobAssignmentId: "8c000000-0000-4000-8000-000000000034",
              openedBy: null,
              status: "OPEN",
              reason: "Vardiya eksik sayıldı.",
              resolution: null,
              resolutionNote: null,
              resolvedAt: null,
              createdAt,
            })),
            5,
          ),
        });
      }),
    );

    const html = await render();

    // Uç panelden sıralanmaz: sort gönderilmez, örneklem yeniden eskiyedir.
    expect(seenUrl!.searchParams.has("sort")).toBe(false);
    expect(seenUrl!.searchParams.get("size")).toBe("50");
    // 1 örneklemde + 3 örneklem dışında (hepsi daha eski) = 4, artı yok.
    expect(html).toContain(">4 kayıt 48 saati aştı<");
    // Kuyruk örneklemden büyük: "en eski" bilinmez, uydurulmaz.
    expect(html).toContain("Kuyruğu aç");
  });

  it("sums the two report queues and never writes the threshold line on a failed tile", async () => {
    stubMe(["content.moderate"]);
    server.use(
      http.get(apiUrl("/admin/reports"), ({ request }) => {
        const status = new URL(request.url).searchParams.get("status");
        return HttpResponse.json({
          success: true,
          message: "ok",
          httpStatus: "200 OK",
          path: "/admin/reports",
          requestId: "rid-rep",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: pageOf(
            status === "OPEN"
              ? [reportRow("OPEN", hoursAgo(72), "11111111-1111-4111-8111-111111111111")]
              : [
                  reportRow("UNDER_REVIEW", hoursAgo(96), "22222222-2222-4222-8222-222222222222"),
                  reportRow("UNDER_REVIEW", hoursAgo(2), "33333333-3333-4333-8333-333333333333"),
                ],
          ),
        });
      }),
    );

    const html = await render();
    expect(html).toContain(">2 kayıt 48 saati aştı<");
    expect(html).toContain('href="/reports?sirala=createdAt%2Casc"');

    server.use(http.get(apiUrl("/admin/reports"), () => HttpResponse.error()));
    const failed = await render();
    expect(failed).toContain("Şikayetler yüklenemedi.");
    expect(failed).not.toContain("saati aştı");
  });
});

describe("stuck payments and overdue payouts", () => {
  it("draws both alarm tiles from the finance summary and links them only with the list permission", async () => {
    stubMe(["finance.read"]);
    watchQueues();

    const unlinked = await render();
    expect(unlinked).toContain('data-testid="alert-tile-stuck-payments"');
    expect(unlinked).toContain("Takılı ödemeler");
    expect(unlinked).toContain("Vadesi geçmiş hakediş");
    expect(unlinked).toMatch(/text-danger">2</);
    expect(unlinked).toMatch(/text-danger">3</);
    expect(unlinked).not.toContain('href="/payments?durum=VERIFY_PENDING"');
    expect(unlinked).not.toContain("/payout-reconciliation?durum=PROCESSING");

    stubMe(["finance.read", "payment.read", "payout.reconcile"]);
    watchQueues();
    const linked = await render();
    expect(linked).toContain('href="/payments?durum=VERIFY_PENDING"');
    expect(linked).toContain(
      'href="/payout-reconciliation?durum=PROCESSING&amp;sirala=createdAt%2Casc"',
    );
  });

  it("keeps a zero quiet and hides the tiles a pre-0.9.26 server cannot count", async () => {
    stubMe(["finance.read", "payment.read"]);
    server.use(
      http.get(apiUrl("/admin/finance/summary"), () =>
        HttpResponse.json(financeBody({ stuckPaymentCount: 0, overduePayoutCount: 0 })),
      ),
    );
    const zero = await render();
    expect(zero).toContain("Takılı ödemeler");
    expect(zero).not.toContain("text-danger");

    server.use(
      http.get(apiUrl("/admin/finance/summary"), () => HttpResponse.json(financeBody({}))),
    );
    const legacy = await render();
    expect(legacy).toContain("Tahsilat");
    expect(legacy).not.toContain("Takılı ödemeler");
    expect(legacy).not.toContain("Vadesi geçmiş hakediş");
  });

  it("shows a load error on both alarm tiles when the summary fails, and none without finance.read", async () => {
    stubMe(["finance.read"]);
    server.use(http.get(apiUrl("/admin/finance/summary"), () => HttpResponse.error()));
    const failed = await render();
    expect(failed).toContain("Takılı ödemeler yüklenemedi.");
    expect(failed).toContain("Vadesi geçmiş hakediş yüklenemedi.");
    expect(failed).not.toContain("Tahsilat");

    stubMe(["payment.read"]);
    const seen = watchQueues();
    const none = await render();
    expect(seen).not.toContain("finance");
    expect(none).not.toContain("Takılı ödemeler");
  });
});

describe("the removed screens section", () => {
  it("no longer lists the reachable screens; the menu already does", async () => {
    stubMe(["category.manage", "audit.read"]);
    watchQueues();

    const html = await render();

    expect(html).not.toContain("Ekranlar");
    expect(html).not.toContain('href="/job-categories"');
    expect(html).toContain("Oturum");
  });
});
