import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminAssignmentFixture } from "../../../../test/fixtures/admin-assignment";
import { categoryCreatedEntry } from "../../../../test/fixtures/audit-log";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

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
    expect(html).toMatch(/user-tab-atamalar-disabled[^>]*>Atamalar<span[^>]*>3</);
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

describe("the denetim tab", () => {
  it("draws the roles and the audit rows for this user with audit.read", async () => {
    stubMe([...READER, "audit.read"]);
    stubUser();
    const audit = watch("/admin/audit-log", () =>
      envelope(
        "/admin/audit-log",
        pageOf(
          [
            {
              ...categoryCreatedEntry,
              permission: "user.role.manage",
              action: "user.role.grant",
              resourceType: "user",
              resourceId: USER_ID,
            },
          ],
          14,
        ),
      ),
    );

    const html = await render({ sekme: "denetim" });

    expect(audit.urls).toHaveLength(1);
    expect(audit.urls[0]?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(audit.urls[0]?.searchParams.get("size")).toBe("10");
    expect(audit.urls[0]?.searchParams.has("permission")).toBe(false);
    expect(html).toContain("Bu kullanıcının hiç rolü yok.");
    expect(html).toContain("user.role.grant");
    expect(html).toContain("Katalog Editörü");
    expect(html).toContain("Toplam 14 kayıt; ilk 1 satır.");
    expect(html).toContain(`href="/audit-log?resourceId=${USER_ID}"`);
  });

  it("keeps the roles but closes the audit half without audit.read, sending no request", async () => {
    stubMe(READER);
    stubUser();
    const audit = watch("/admin/audit-log", () => envelope("/admin/audit-log", pageOf([])));

    const html = await render({ sekme: "denetim" });

    expect(audit.urls).toHaveLength(0);
    expect(html).toContain("Bu kullanıcının hiç rolü yok.");
    expect(html).toContain('data-testid="user-inline-audit-disabled"');
    expect(html).toContain("audit.read");
    expect(html).not.toContain(`href="/audit-log?resourceId=${USER_ID}"`);
  });

  it("says when the audit log has nothing for this user", async () => {
    stubMe([...READER, "audit.read"]);
    stubUser();
    watch("/admin/audit-log", () => envelope("/admin/audit-log", pageOf([])));

    const html = await render({ sekme: "denetim" });

    expect(html).toContain("Bu kullanıcı için kaydedilmiş personel işlemi yok.");
    expect(html).toContain(`href="/audit-log?resourceId=${USER_ID}"`);
  });
});
