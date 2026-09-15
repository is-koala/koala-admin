import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminAssignmentFixture } from "../../../../test/fixtures/admin-assignment";
import { categoryCreatedEntry } from "../../../../test/fixtures/audit-log";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";
import { detailValuesOf, watchAudit } from "../../../../test/support/watch-audit";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { default: UserDetailPage } = await import("./[id]/page");

/**
 * koala-admin#103: kullanıcı sayfasının sekmeleri. Her sekme için üç durum —
 * dolu, boş, izinsiz — artı URL parametresi ve "Tümünü aç" adresleri. İstek
 * sayıları da iddia: seçili olmayan sekme için backend'e gidilmez, izinsiz
 * sekme hiç istek çıkarmaz.
 */

const USER_ID = "aaaaaaaa-1111-4111-8111-111111111111";
const ASSIGNMENT_ID = "9a1c0f10-0001-4c00-8000-0000000000aa";
const ADMIN_ME = apiUrl("/admin/me");

const READER = ["user.read"];

const USER = {
  id: USER_ID,
  firstName: "Ada",
  lastName: "Yılmaz",
  username: "ada",
  profilePictureUrl: null,
  counts: {
    applications: 0,
    assignmentsAsWorker: 2,
    assignmentsAsEmployer: 1,
    payments: 1,
    payouts: 1,
    disputes: 1,
    reportsReceived: 1,
    reportsMade: 1,
  },
};

const PAYOUT = {
  id: "9c000000-0000-4000-8000-000000000033",
  jobAssignmentId: ASSIGNMENT_ID,
  recipient: { id: USER_ID, firstName: "Ada", lastName: "Yılmaz", username: "ada" },
  maskedIban: "TR18***2315",
  providerReference: "iyz-transaction-000033",
  amount: "1240.50",
  currency: "TRY",
  status: "COMPLETED",
  failureReason: null,
  completedAt: "2026-09-03T10:00:00.000000000Z",
  createdAt: "2026-09-02T10:00:00.000000000Z",
};

const DISPUTE = {
  id: "d1000000-0000-4000-8000-000000000001",
  jobAssignmentId: ASSIGNMENT_ID,
  openedBy: { id: USER_ID, firstName: "Ada", lastName: "Yılmaz", username: "ada" },
  status: "OPEN",
  reason: "Vardiya eksik sayıldı.",
  resolution: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: "2026-09-05T08:00:00.000000000Z",
};

const REPORT = {
  id: "5b000000-0000-4000-8000-000000000001",
  reporter: { id: "bbbbbbbb-2222-4222-8222-222222222222", firstName: "Can", lastName: "Kaya" },
  reportedUser: { id: USER_ID, firstName: "Ada", lastName: "Yılmaz" },
  reportedUserId: USER_ID,
  jobId: null,
  messageId: null,
  imageId: null,
  reason: "HARASSMENT",
  description: null,
  status: "OPEN",
  reviewedBy: null,
  reviewNote: null,
  reviewedAt: null,
  createdAt: "2026-09-06T08:00:00.000000000Z",
  reportedUserReportCount: 1,
};

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  backendSaysPasswordMustChange.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  backendSaysPasswordMustChange.mockReset();
});

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: {
          ...adminMeSuccessBody.data,
          roles: ["SUPPORT_AGENT"],
          permissions: [...permissions],
        },
      }),
    ),
  );
}

function envelope(path: string, data: unknown) {
  return HttpResponse.json({
    success: true,
    message: "OK",
    httpStatus: "200 OK",
    path,
    requestId: `rid-${path}`,
    timeStamp: "2026-09-11T13:00:00.000000000Z",
    data,
  });
}

function pageOf(content: readonly unknown[], totalElements = content.length) {
  return {
    content,
    page: 0,
    size: 10,
    totalElements,
    totalPages: totalElements === 0 ? 0 : Math.ceil(totalElements / 10),
    first: true,
    last: totalElements <= content.length,
  };
}

function stubUser(user: unknown = USER) {
  server.use(
    http.get(apiUrl(`/admin/users/${USER_ID}`), () => envelope(`/admin/users/${USER_ID}`, user)),
    http.get(apiUrl("/admin/users/:userId/roles"), () =>
      envelope(`/admin/users/${USER_ID}/roles`, []),
    ),
  );
}

interface Seen {
  readonly urls: URL[];
}

/** Bir liste ucunu izler; her çağrının URL'sini saklar. */
function watch(path: string, respond: (url: URL) => Response): Seen {
  const urls: URL[] = [];
  server.use(
    http.get(apiUrl(path), ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      return respond(url);
    }),
  );
  return { urls };
}

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(
      <UserDetailPage
        params={Promise.resolve({ id: USER_ID })}
        searchParams={Promise.resolve(params)}
      />,
    )
  ).replaceAll("<!-- -->", "");

describe("the tab strip and the URL parameter", () => {
  it("opens genel by default, marks the active tab and falls back on an unknown value", async () => {
    stubMe(READER);
    stubUser();

    const byDefault = await render();
    expect(byDefault).toContain('data-testid="user-tabs"');
    expect(byDefault).toMatch(/<a aria-current="page" data-testid="user-tab-genel"/);
    expect(byDefault).toContain('data-testid="user-history"');

    stubUser();
    const unknown = await render({ sekme: "banana" });
    expect(unknown).toMatch(/<a aria-current="page" data-testid="user-tab-genel"/);

    stubUser();
    const denetim = await render({ sekme: "denetim" });
    expect(denetim).toMatch(/<a aria-current="page" data-testid="user-tab-denetim"/);
    expect(denetim).not.toContain('data-testid="user-history"');
  });

  it("carries the tab in the href and leaves genel without a query", async () => {
    stubMe([...READER, "payment.read"]);
    stubUser();

    const html = await render();

    expect(html).toContain(`href="/users/${USER_ID}"`);
    expect(html).not.toContain("sekme=genel");
    expect(html).toContain(`href="/users/${USER_ID}?sekme=atamalar"`);
    expect(html).toContain(`href="/users/${USER_ID}?sekme=denetim"`);
  });

  it("shows a tab without its permission as disabled, with the permission named, and never links it", async () => {
    stubMe(READER);
    stubUser();

    const html = await render();

    for (const [tab, permission] of [
      ["atamalar", "payment.read"],
      ["hakedisler", "payout.reconcile"],
      ["banka", "user.read_pii"],
      ["uyusmazliklar", "dispute.resolve"],
      ["sikayetler", "content.moderate"],
    ]) {
      // Gerekçe pilin içinde görünür metin; klavye için odaklanabilir, bağlantı değil.
      expect(html).toMatch(
        new RegExp(
          `<span aria-disabled="true" tabindex="0" data-testid="user-tab-${tab}-disabled"[^>]*>[^]*?<code class="font-mono">${permission}</code> gerekir`,
        ),
      );
      expect(html).not.toContain(`href="/users/${USER_ID}?sekme=${tab}"`);
    }
    // İzin olmayınca sayaç rozeti yine yazılır: sayı user.read'in verisi.
    expect(html).toMatch(/user-tab-atamalar-disabled[^>]*>Atamalar<span[^>]*>[\s\S]*?3</);
  });

  it("explains a disabled tab that was asked for by URL and sends no list request", async () => {
    stubMe(READER);
    stubUser();
    const assignments = watch("/admin/job-assignments", () =>
      envelope("/admin/job-assignments", pageOf([adminAssignmentFixture()])),
    );

    const html = await render({ sekme: "atamalar" });

    expect(assignments.urls).toHaveLength(0);
    expect(html).toContain('data-testid="user-tab-disabled-notice"');
    expect(html).toContain("payment.read");
    expect(html).toContain("liste isteği gönderilmedi");
    expect(html).not.toContain("Garsonluk");
  });

  it("requests only the selected tab's lists", async () => {
    stubMe([
      ...READER,
      "payment.read",
      "payout.reconcile",
      "dispute.resolve",
      "content.moderate",
      "audit.read",
    ]);
    stubUser();
    const assignments = watch("/admin/job-assignments", () =>
      envelope("/admin/job-assignments", pageOf([])),
    );
    const payouts = watch("/admin/payouts", () => envelope("/admin/payouts", pageOf([])));
    const disputes = watch("/admin/disputes", () => envelope("/admin/disputes", pageOf([])));
    const reports = watch("/admin/reports", () => envelope("/admin/reports", pageOf([])));
    const audit = watch("/admin/audit-log", () => envelope("/admin/audit-log", pageOf([])));

    await render({ sekme: "hakedisler" });

    expect(payouts.urls).toHaveLength(1);
    expect(assignments.urls).toHaveLength(0);
    expect(disputes.urls).toHaveLength(0);
    // Genel sekmesinin "açık şikayetler" kutusu da yalnız genelde okunur.
    expect(reports.urls).toHaveLength(0);
    expect(audit.urls).toHaveLength(0);
  });
});

describe("the atamalar tab", () => {
  it("draws the first ten rows as worker and as employer and links the full lists", async () => {
    stubMe([...READER, "payment.read"]);
    stubUser();
    const assignments = watch("/admin/job-assignments", (url) =>
      envelope(
        "/admin/job-assignments",
        url.searchParams.has("workerId")
          ? pageOf(
              Array.from({ length: 10 }, (_, index) =>
                adminAssignmentFixture({
                  id: `9a1c0f10-0001-4c00-8000-0000000000${String(index).padStart(2, "0")}`,
                  jobTitle: `İşçi vardiyası ${index}`,
                }),
              ),
              12,
            )
          : pageOf([adminAssignmentFixture({ jobTitle: "İşveren ilanı" })]),
      ),
    );

    const html = await render({ sekme: "atamalar" });

    expect(assignments.urls).toHaveLength(2);
    const worker = assignments.urls.find((url) => url.searchParams.has("workerId"));
    const employer = assignments.urls.find((url) => url.searchParams.has("employerId"));
    expect(worker?.searchParams.get("workerId")).toBe(USER_ID);
    expect(worker?.searchParams.get("size")).toBe("10");
    expect(worker?.searchParams.get("page")).toBe("0");
    expect(employer?.searchParams.get("employerId")).toBe(USER_ID);
    expect(employer?.searchParams.has("workerId")).toBe(false);

    expect(html).toContain("İşçi vardiyası 0");
    expect(html).toContain("İşçi vardiyası 9");
    expect(html).toContain("Toplam 12 atama; ilk 10 satır.");
    expect(html).toContain("İşveren ilanı");
    expect(html).toContain("Toplam 1 atama.");
    expect(html).toMatch(
      new RegExp(
        `data-testid="user-inline-assignments-worker-all" href="/assignments\\?isci=${USER_ID}">Tümünü aç`,
      ),
    );
    expect(html).toContain(`href="/assignments?isci=${USER_ID}"`);
    expect(html).toContain(`href="/assignments?isveren=${USER_ID}"`);
    expect(html).toContain(`href="/assignments/${ASSIGNMENT_ID}"`);
  });

  it("says when a role has no assignments and still offers the list", async () => {
    stubMe([...READER, "payment.read"]);
    stubUser();
    watch("/admin/job-assignments", () => envelope("/admin/job-assignments", pageOf([])));

    const html = await render({ sekme: "atamalar" });

    expect(html).toContain("Bu kullanıcının işçi olarak ataması yok.");
    expect(html).toContain("Bu kullanıcının işveren olarak ataması yok.");
    expect(html).toContain(`href="/assignments?isci=${USER_ID}"`);
  });

  it("shows the backend's failure for one section without blanking the other", async () => {
    stubMe([...READER, "payment.read"]);
    stubUser();
    watch("/admin/job-assignments", (url) =>
      url.searchParams.has("workerId")
        ? HttpResponse.json(
            {
              success: false,
              message: "Atama servisi yanıt vermedi.",
              httpStatus: "503 SERVICE_UNAVAILABLE",
              errorCode: "UPSTREAM_UNAVAILABLE",
              errorCategory: "SERVER",
              requestId: "rid-503",
              path: "/admin/job-assignments",
              timeStamp: "2026-09-11T13:00:00.000000000Z",
            },
            { status: 503 },
          )
        : envelope("/admin/job-assignments", pageOf([adminAssignmentFixture()])),
    );

    const html = await render({ sekme: "atamalar" });

    expect(html).toContain("İşçi olarak atamaları yüklenemedi.");
    expect(html).toContain("rid-503");
    expect(html).toContain("Garsonluk");
    expect(html).not.toContain("Bu kullanıcının işçi olarak ataması yok.");
  });
});

describe("the hakedisler tab", () => {
  it("asks for every status, draws the badge from the row and links the full list", async () => {
    stubMe([...READER, "payout.reconcile"]);
    stubUser();
    const payouts = watch("/admin/payouts", () => envelope("/admin/payouts", pageOf([PAYOUT])));

    const html = await render({ sekme: "hakedisler" });

    expect(payouts.urls).toHaveLength(1);
    expect(payouts.urls[0]?.searchParams.get("workerId")).toBe(USER_ID);
    expect(payouts.urls[0]?.searchParams.get("status")).toBe("PENDING,PROCESSING,COMPLETED,FAILED");
    expect(payouts.urls[0]?.searchParams.get("size")).toBe("10");
    expect(html).toContain("Tamamlandı");
    expect(html).not.toContain("İşleniyor");
    expect(html).toContain(`href="/payout-reconciliation/${PAYOUT.id}"`);
    expect(html).toContain(`href="/payout-reconciliation?isci=${USER_ID}&amp;durum=hepsi"`);
    // Kuyrukla aynı tablo bileşeni, işçi sütunu dâhil; onay sütunu yalnız kuyrukta.
    expect(html).toContain(">İşçi</th>");
    expect(html).not.toContain(">Onay</th>");
    expect(html).not.toContain("Onayla");
    expect(html).not.toContain(">Sağlayıcı referansı</th>");
    expect(html).not.toContain(">Maskeli IBAN</th>");
    expect(html).not.toContain("iyz-transaction-000033");
    expect(html).not.toContain("TR18***2315");
  });

  it("tells an empty list from a missing permission", async () => {
    stubMe([...READER, "payout.reconcile"]);
    stubUser();
    watch("/admin/payouts", () => envelope("/admin/payouts", pageOf([])));
    const empty = await render({ sekme: "hakedisler" });
    expect(empty).toContain("Bu kullanıcının hakedişi yok.");

    stubMe(READER);
    stubUser();
    const payouts = watch("/admin/payouts", () => envelope("/admin/payouts", pageOf([PAYOUT])));
    const denied = await render({ sekme: "hakedisler" });
    expect(payouts.urls).toHaveLength(0);
    expect(denied).toContain('data-testid="user-tab-disabled-notice"');
    expect(denied).toContain("payout.reconcile");
  });
});

describe("the uyusmazliklar tab", () => {
  it("lists pending and resolved disputes, reads escrow amounts only with payment.read", async () => {
    stubMe([...READER, "dispute.resolve", "payment.read"]);
    stubUser();
    const disputes = watch("/admin/disputes", (url) =>
      envelope(
        "/admin/disputes",
        url.searchParams.get("status") === "RESOLVED"
          ? pageOf([
              {
                ...DISPUTE,
                id: "d1000000-0000-4000-8000-000000000002",
                status: "RESOLVED",
                resolution: "RELEASE_TO_WORKER",
                resolvedAt: "2026-09-06T08:00:00.000000000Z",
              },
            ])
          : pageOf([DISPUTE]),
      ),
    );
    const summaries = watch(`/admin/job-assignments/${ASSIGNMENT_ID}`, () =>
      envelope(`/admin/job-assignments/${ASSIGNMENT_ID}`, adminAssignmentFixture()),
    );

    const html = await render({ sekme: "uyusmazliklar" });

    expect(disputes.urls).toHaveLength(2);
    for (const url of disputes.urls) {
      expect(url.searchParams.get("userId")).toBe(USER_ID);
      expect(url.searchParams.get("size")).toBe("10");
    }
    expect(disputes.urls.filter((url) => url.searchParams.has("status"))).toHaveLength(1);
    expect(summaries.urls).toHaveLength(2);
    expect(html).toContain("Açık");
    expect(html).toContain("Çözüldü");
    expect(html).toContain("1.378,33");
    expect(html).toContain(`href="/disputes?kullanici=${USER_ID}"`);
    expect(html).toContain(`href="/disputes?kullanici=${USER_ID}&amp;durum=RESOLVED"`);
    expect(html).toContain(`href="/disputes/${DISPUTE.id}"`);
  });

  it("keeps the amount column empty and skips the summary request without payment.read", async () => {
    stubMe([...READER, "dispute.resolve"]);
    stubUser();
    watch("/admin/disputes", () => envelope("/admin/disputes", pageOf([DISPUTE])));
    const summaries = watch(`/admin/job-assignments/${ASSIGNMENT_ID}`, () =>
      envelope(`/admin/job-assignments/${ASSIGNMENT_ID}`, adminAssignmentFixture()),
    );

    const html = await render({ sekme: "uyusmazliklar" });

    expect(summaries.urls).toHaveLength(0);
    expect(html).not.toContain("1.378,33");
    expect(html).toContain("özet isteği gönderilmedi");
  });

  it("says when there is nothing pending or resolved, and is disabled without dispute.resolve", async () => {
    stubMe([...READER, "dispute.resolve"]);
    stubUser();
    watch("/admin/disputes", () => envelope("/admin/disputes", pageOf([])));
    const empty = await render({ sekme: "uyusmazliklar" });
    expect(empty).toContain("Bu kullanıcının bekleyen uyuşmazlığı yok.");
    expect(empty).toContain("Bu kullanıcının çözülmüş uyuşmazlığı yok.");

    stubMe(READER);
    stubUser();
    const disputes = watch("/admin/disputes", () => envelope("/admin/disputes", pageOf([DISPUTE])));
    const denied = await render({ sekme: "uyusmazliklar" });
    expect(disputes.urls).toHaveLength(0);
    expect(denied).toContain("dispute.resolve");
    expect(denied).toContain('data-testid="user-tab-disabled-notice"');
  });
});

describe("the sikayetler tab", () => {
  it("lists reports about the user and by the user in every status", async () => {
    stubMe([...READER, "content.moderate"]);
    stubUser();
    const reports = watch("/admin/reports", (url) =>
      envelope(
        "/admin/reports",
        url.searchParams.has("reporterId")
          ? pageOf([
              {
                ...REPORT,
                id: "5b000000-0000-4000-8000-000000000002",
                reason: "SPAM",
                status: "DISMISSED",
              },
            ])
          : pageOf([REPORT]),
      ),
    );

    const html = await render({ sekme: "sikayetler" });

    expect(reports.urls).toHaveLength(2);
    const about = reports.urls.find((url) => url.searchParams.has("reportedUserId"));
    const made = reports.urls.find((url) => url.searchParams.has("reporterId"));
    expect(about?.searchParams.get("reportedUserId")).toBe(USER_ID);
    expect(about?.searchParams.has("status")).toBe(false);
    expect(about?.searchParams.get("size")).toBe("10");
    expect(made?.searchParams.get("reporterId")).toBe(USER_ID);
    expect(made?.searchParams.has("reportedUserId")).toBe(false);

    expect(html).toContain("Taciz");
    expect(html).toContain("Spam");
    expect(html).toContain(`href="/reports/${REPORT.id}"`);
    expect(html).toContain(`href="/reports?kullanici=${USER_ID}&amp;durum=hepsi"`);
    expect(html).toContain(`href="/reports?sikayetci=${USER_ID}&amp;durum=hepsi"`);
  });

  it("says when both lists are empty, and is disabled without content.moderate", async () => {
    stubMe([...READER, "content.moderate"]);
    stubUser();
    watch("/admin/reports", () => envelope("/admin/reports", pageOf([])));
    const empty = await render({ sekme: "sikayetler" });
    expect(empty).toContain("Bu kullanıcı hakkında şikayet yok.");
    expect(empty).toContain("Bu kullanıcı şikayet açmamış.");

    stubMe(READER);
    stubUser();
    const reports = watch("/admin/reports", () => envelope("/admin/reports", pageOf([REPORT])));
    const denied = await render({ sekme: "sikayetler" });
    expect(reports.urls).toHaveLength(0);
    expect(denied).toContain("content.moderate");
  });
});

describe("the banka tab", () => {
  const ACCOUNT = {
    id: "7c000000-0000-4000-8000-000000000048",
    maskedIban: "TR18***2315",
    verificationStatus: "VERIFIED",
    primary: true,
    accountHolderNameVerified: true,
    verifiedAt: "2026-09-02T10:00:00.000000000Z",
    createdAt: "2026-09-01T10:00:00.000000000Z",
  };
  const PENDING_ACCOUNT = {
    ...ACCOUNT,
    id: "7c000000-0000-4000-8000-000000000049",
    maskedIban: "TR33***9001",
    verificationStatus: "PENDING",
    primary: false,
    accountHolderNameVerified: false,
    verifiedAt: null,
  };
  const PENDING_ROW = {
    accountId: PENDING_ACCOUNT.id,
    user: { id: USER_ID, firstName: "Ada", lastName: "Yılmaz", username: "ada" },
    maskedIban: "TR33***9001",
    reference: "KOALA-9F3A2C",
    amount: "0.17",
    startedAt: "2026-09-11T12:00:00Z",
    expiresAt: "2026-09-12T12:00:00Z",
    attemptsLeft: 2,
    createdAt: "2026-09-11T11:00:00Z",
  };
  const BANK_ACCOUNTS = `/admin/users/${USER_ID}/bank-accounts`;

  /**
   * koala-admin#108: hesaplar `user.read_pii`, bekleyenler `bank.account.verify`.
   * İkisi de varken iki istek; bekleyenler `userId=` ile süzülür ve "Tümünü aç"
   * kuyruğu `?kullanici=` ile açar. Tam IBAN hiçbir yerde yok.
   */
  it("lists the accounts and the user's pending verifications, and links the filtered queue", async () => {
    stubMe([...READER, "user.read_pii", "bank.account.verify"]);
    stubUser();
    const accounts = watch(BANK_ACCOUNTS, () =>
      envelope(BANK_ACCOUNTS, [ACCOUNT, PENDING_ACCOUNT]),
    );
    const pending = watch("/admin/bank-account-verifications", () =>
      envelope("/admin/bank-account-verifications", pageOf([PENDING_ROW])),
    );

    const html = await render({ sekme: "banka" });

    expect(accounts.urls).toHaveLength(1);
    expect(pending.urls).toHaveLength(1);
    expect(pending.urls[0]?.searchParams.get("userId")).toBe(USER_ID);
    expect(pending.urls[0]?.searchParams.get("status")).toBe("PENDING");
    expect(pending.urls[0]?.searchParams.get("size")).toBe("10");
    expect(html).toMatch(/<a aria-current="page" data-testid="user-tab-banka"/);
    expect(html).toContain('data-testid="user-bank-accounts"');
    expect(html).toContain("TR18***2315");
    expect(html).toContain("TR33***9001");
    expect(html).toContain("Doğrulandı");
    expect(html).toContain("Bekliyor");
    expect(html).toContain("Birincil");
    expect(html).toContain("02.09.2026 13:00");
    expect(html).toContain('data-testid="user-inline-iban-pending"');
    expect(html).toContain("Toplam 1 doğrulama.");
    expect(html).toContain('href="/iban-verifications/KOALA-9F3A2C"');
    expect(html).toContain(`href="/iban-verifications?kullanici=${USER_ID}"`);
    expect(html).not.toContain("TR180006");
  });

  it("says when there is no account and no pending verification", async () => {
    stubMe([...READER, "user.read_pii", "bank.account.verify"]);
    stubUser();
    watch(BANK_ACCOUNTS, () => envelope(BANK_ACCOUNTS, []));
    watch("/admin/bank-account-verifications", () =>
      envelope("/admin/bank-account-verifications", pageOf([])),
    );

    const html = await render({ sekme: "banka" });

    expect(html).toContain("Bu kullanıcının kayıtlı banka hesabı yok.");
    expect(html).toContain("Bu kullanıcının bekleyen IBAN doğrulaması yok.");
  });

  it("closes the pending half without bank.account.verify and sends no queue request", async () => {
    stubMe([...READER, "user.read_pii"]);
    stubUser();
    watch(BANK_ACCOUNTS, () => envelope(BANK_ACCOUNTS, [ACCOUNT]));
    const pending = watch("/admin/bank-account-verifications", () =>
      envelope("/admin/bank-account-verifications", pageOf([PENDING_ROW])),
    );

    const html = await render({ sekme: "banka" });

    expect(pending.urls).toHaveLength(0);
    expect(html).toContain("TR18***2315");
    expect(html).toContain('data-testid="user-inline-iban-pending-disabled"');
    expect(html).toContain("bank.account.verify");
    expect(html).not.toContain("KOALA-9F3A2C");
  });

  it("is disabled without user.read_pii and asks for nothing", async () => {
    stubMe([...READER, "bank.account.verify"]);
    stubUser();
    const accounts = watch(BANK_ACCOUNTS, () => envelope(BANK_ACCOUNTS, [ACCOUNT]));
    const pending = watch("/admin/bank-account-verifications", () =>
      envelope("/admin/bank-account-verifications", pageOf([PENDING_ROW])),
    );

    const html = await render({ sekme: "banka" });

    expect(accounts.urls).toHaveLength(0);
    expect(pending.urls).toHaveLength(0);
    expect(html).toContain('data-testid="user-tab-disabled-notice"');
    expect(html).toContain("user.read_pii");
    expect(html).not.toContain("TR18***2315");
  });

  it("shows the backend's answer for the accounts without blanking the pending half", async () => {
    stubMe([...READER, "user.read_pii", "bank.account.verify"]);
    stubUser();
    watch(BANK_ACCOUNTS, () =>
      HttpResponse.json(
        {
          success: false,
          message: "Kullanıcı bulunamadı.",
          httpStatus: "404 NOT_FOUND",
          errorCode: "USER_NOT_FOUND_BY_ID",
          errorCategory: "RESOURCE_NOT_FOUND",
          requestId: "rid-bank-404",
          path: BANK_ACCOUNTS,
          timeStamp: "2026-09-11T13:00:00.000000000Z",
        },
        { status: 404 },
      ),
    );
    watch("/admin/bank-account-verifications", () =>
      envelope("/admin/bank-account-verifications", pageOf([PENDING_ROW])),
    );

    const html = await render({ sekme: "banka" });

    expect(html).toContain("Banka hesapları yüklenemedi.");
    expect(html).toContain("rid-bank-404");
    expect(html).toContain("KOALA-9F3A2C");
  });
});

describe("the denetim tab", () => {
  const BADGE = {
    code: "PUNCTUAL",
    family: "RELIABILITY",
    tier: "GOLD",
    name: "Dakik",
    description: null,
    iconUrl: null,
    earnedAt: "2026-09-04T10:00:00.000000000Z",
  };
  const USER_WITH_HISTORY = {
    ...USER,
    createdAt: "2026-09-01T09:00:00.000000000Z",
    badges: [BADGE],
  };
  const GRANT_ROW = {
    ...categoryCreatedEntry,
    occurredAt: "2026-09-03T12:00:00.000Z",
    permission: "user.role.manage",
    action: "user.role.grant",
    resourceType: "users",
    resourceId: USER_ID,
  };

  /**
   * koala-admin#107: kaydın kendi anları (hesap açılışı, rozet) ve personel
   * kararları tek çizelgede, zamana göre. Rol yazımı 03.09, rozet 04.09,
   * açılış 01.09: satırlar etikete değil zamana göre dizilir.
   */
  it("merges the user's own events with the audit rows in one timeline, with audit.read", async () => {
    stubMe([...READER, "audit.read"]);
    stubUser(USER_WITH_HISTORY);
    const audit = watchAudit({ rows: [GRANT_ROW], totalElements: 14 });

    const html = await render({ sekme: "denetim" });

    expect(audit.urls).toHaveLength(1);
    expect(audit.urls[0]?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(audit.urls[0]?.searchParams.get("size")).toBe("10");
    expect(audit.urls[0]?.searchParams.has("permission")).toBe(false);
    expect(html).toContain("Bu kullanıcının hiç rolü yok.");

    const timeline = html.slice(html.indexOf('data-testid="object-timeline"'));
    const positions = ["Hesap oluşturuldu", "user.role.grant", "Rozet kazanıldı"].map((label) =>
      timeline.indexOf(label),
    );
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(timeline).toContain("Katalog Editörü");
    expect(timeline).toContain("Dakik");
    expect(timeline).toContain("Denetim izinden en yeni 1 satır; toplam 14 kayıt.");
    // Denetim sayfasına tek bağlantı: `ObjectAuditPointer`'ınki.
    expect(html.match(/href="\/audit-log\?resourceId=/g)).toHaveLength(1);
    expect(html).toContain(`href="/audit-log?resourceId=${USER_ID}"`);
    // Aktör bağlantısı `staff.read` ister; READER'da yok, ad düz metin.
    expect(timeline).not.toContain("/staff#personel-");
    // Ayrıntı yarısı (gövde, IP, tarayıcı) çizelgeye inmez.
    for (const value of detailValuesOf(GRANT_ROW)) expect(html).not.toContain(value);
  });

  /**
   * Backend silme talebi kararını talep kimliğiyle yazar
   * (`AuditScope.resourceIdOf` ilk yol değişkeni); kullanıcı kimliğine süzen
   * sorgu onu getirmez. Bekleyen talep varsa ikinci sorgu, tek liste.
   */
  it("also asks for the pending deletion request's rows and merges them", async () => {
    const REQUEST_ID = "de000000-0000-4000-8000-000000000001";
    stubMe([...READER, "audit.read"]);
    stubUser({ ...USER_WITH_HISTORY, pendingDeletionRequestId: REQUEST_ID });
    const audit = watchAudit({
      rowsFor: {
        [USER_ID]: [GRANT_ROW],
        [REQUEST_ID]: [
          {
            ...GRANT_ROW,
            id: "aa000000-0000-4c00-8000-0000000000de",
            occurredAt: "2026-09-05T09:00:00.000Z",
            permission: "user.deletion.manage",
            action: "account-deletions.reject",
            resourceType: "account-deletions",
            resourceId: REQUEST_ID,
          },
        ],
      },
    });

    const html = await render({ sekme: "denetim" });

    expect(audit.urls).toHaveLength(2);
    expect(audit.urlsFor(USER_ID)).toHaveLength(1);
    expect(audit.urlsFor(REQUEST_ID)).toHaveLength(1);
    const timeline = html.slice(html.indexOf('data-testid="object-timeline"'));
    expect(timeline.indexOf("user.role.grant")).toBeLessThan(
      timeline.indexOf("account-deletions.reject"),
    );
    expect(timeline).toContain("Denetim izinden 2 kayıt.");
  });

  /** koala-admin#108: son kimlik incelemesinin kararı da inceleme kimliğiyle yazılır. */
  it("also asks for the identity review's rows when the DTO names one, and not otherwise", async () => {
    const REVIEW_ID = "1d000000-0000-4000-8000-00000000001d";
    stubMe([...READER, "audit.read"]);
    stubUser({
      ...USER_WITH_HISTORY,
      identityReviewId: REVIEW_ID,
      identityReviewStatus: "APPROVED",
    });
    const audit = watchAudit({
      rowsFor: {
        [USER_ID]: [GRANT_ROW],
        [REVIEW_ID]: [
          {
            ...GRANT_ROW,
            id: "aa000000-0000-4c00-8000-0000000000id",
            occurredAt: "2026-09-06T09:00:00.000Z",
            permission: "identity.review",
            action: "identity-verifications.approve",
            resourceType: "identity-verifications",
            resourceId: REVIEW_ID,
          },
        ],
      },
    });

    const html = await render({ sekme: "denetim" });

    expect(audit.urls).toHaveLength(2);
    expect(audit.urlsFor(REVIEW_ID)).toHaveLength(1);
    const timeline = html.slice(html.indexOf('data-testid="object-timeline"'));
    expect(timeline).toContain("identity-verifications.approve");
    expect(timeline).toContain("Denetim izinden 2 kayıt.");

    // Kimliği göndermeyen sunucu: tek sorgu, ikinci uydurulmaz.
    stubUser({ ...USER_WITH_HISTORY, identityReviewStatus: "APPROVED" });
    const legacy = watchAudit({ rows: [GRANT_ROW] });
    await render({ sekme: "denetim" });
    expect(legacy.urls).toHaveLength(1);
  });

  it("links the actor to the staff page for a staff.read holder", async () => {
    stubMe([...READER, "audit.read", "staff.read"]);
    stubUser();
    watchAudit({ rows: [GRANT_ROW] });

    const html = await render({ sekme: "denetim" });

    expect(html).toContain(`href="/staff#personel-${categoryCreatedEntry.actorStaffId}"`);
  });

  it("keeps the roles and the record's own events but closes the audit half without audit.read, sending no request", async () => {
    stubMe(READER);
    stubUser({
      ...USER_WITH_HISTORY,
      pendingDeletionRequestId: "de000000-0000-4000-8000-000000000001",
    });
    const audit = watchAudit();

    const html = await render({ sekme: "denetim" });

    expect(audit.urls).toHaveLength(0);
    expect(html).toContain("Bu kullanıcının hiç rolü yok.");
    expect(html).toContain("Hesap oluşturuldu");
    expect(html).toContain('data-testid="object-timeline-audit-disabled"');
    expect(html).toContain("audit.read");
    expect(html).not.toContain("/audit-log?");
    expect(html).not.toContain("Her değişiklik denetim kaydında");
  });

  it("says when neither the record nor the audit log has a dated event", async () => {
    stubMe([...READER, "audit.read"]);
    // Eski sunucu: `createdAt` ve rozet yok; denetim de boş.
    stubUser();
    watchAudit();

    const html = await render({ sekme: "denetim" });

    expect(html).toContain("Bu kullanıcı için zamanı bilinen bir olay yok.");
    expect(html).toContain("Bu kayıt için denetim satırı yok.");
    expect(html).toContain(`href="/audit-log?resourceId=${USER_ID}"`);
    expect(html).toContain("Her değişiklik denetim kaydında");
  });

  it("keeps the record's own events and shows the backend's answer when the audit read fails", async () => {
    stubMe([...READER, "audit.read"]);
    stubUser(USER_WITH_HISTORY);
    watchAudit({
      respond: () =>
        HttpResponse.json(
          {
            success: false,
            message: "Denetim deposu yanıt vermedi.",
            httpStatus: "503 SERVICE_UNAVAILABLE",
            errorCode: "AUDIT_UNAVAILABLE",
            errorCategory: "UPSTREAM_FAILED",
            requestId: "rid-audit-503",
            path: "/admin/audit-log",
            timeStamp: "2026-09-11T13:00:00.000000000Z",
          },
          { status: 503 },
        ),
    });

    const html = await render({ sekme: "denetim" });

    expect(html).toContain("Hesap oluşturuldu");
    expect(html).toContain("Denetim izi yüklenemedi.");
    expect(html).toContain("Denetim deposu yanıt vermedi.");
    expect(html).not.toContain("Bu kayıt için denetim satırı yok.");
  });
});
