import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adminMeSuccessBody,
  endpointNotFoundBody,
  resourceNotFoundBody,
  searchQueryTooLongBody,
} from "../../../../test/fixtures/envelopes";
import {
  STAFF_HREF,
  STAFF_ID,
  STAFF_NAME,
  stubStaffMember,
} from "../../../../test/support/stub-staff-member";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * koala-admin#7's acceptance criteria, rendered.
 *
 * Two assertions carry most of the weight and neither is about markup:
 *
 *  - `queue.calls === 0` for a staff member without `content.moderate`. Slice 1
 *    established that a gate is a claim about *requests*, and a test that only
 *    looked for absent HTML would pass against a page that fetched the reports
 *    and hid them.
 *  - The query string. "Filters and paging go to the server" is a property of a
 *    URL; a row count cannot distinguish it from a page filtered in the panel.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: ReportsPage } = await import("./page");
const { default: ReportDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const REPORTS = apiUrl("/admin/reports");

const MODERATOR = ["content.moderate"];
/** A CATALOG_EDITOR holds one permission and it is not this one. */
const CATALOG_EDITOR = ["category.manage"];
/**
 * A DISPUTE_HANDLER, on purpose. koala-admin#7 puts report review behind
 * `content.moderate` rather than `dispute.resolve` precisely so that settling a
 * money dispute does not come with the power to take images down.
 */
const DISPUTE_HANDLER = ["dispute.resolve", "user.read"];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["MODERATOR"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

interface ReportPerson {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  profilePictureUrl: string | null;
}

interface ReportRow {
  id: string;
  reporter: ReportPerson | null;
  reportedUser: ReportPerson | null;
  reportedUserId: string | null;
  jobId: string | null;
  jobAssignmentId?: string | null;
  messageId: string | null;
  imageId: string | null;
  reason: string;
  description: string | null;
  status: string;
  reviewedBy: ReportPerson | null;
  reviewedByStaffId?: string | null;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
  reportedUserReportCount: number;
}

const REPORTER: ReportPerson = {
  id: "dddddddd-0000-4000-8000-000000000004",
  firstName: "Ayşe",
  lastName: "Kaya",
  username: "ayse",
  profilePictureUrl: null,
};

const REPORTED: ReportPerson = {
  id: "aaaaaaaa-0000-4000-8000-000000000001",
  firstName: "Berk",
  lastName: "Yılmaz",
  username: "berk",
  profilePictureUrl: null,
};

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reporter: REPORTER,
    reportedUser: REPORTED,
    reportedUserId: REPORTED.id,
    jobId: null,
    messageId: null,
    imageId: null,
    reason: "HARASSMENT",
    description: "Mesajlarda hakaret etti.",
    status: "OPEN",
    reviewedBy: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: "2026-09-01T08:00:00Z",
    reportedUserReportCount: 3,
    ...overrides,
  };
}

/** Counts and records every call to the queue endpoint, whatever the gate did. */
function watchQueue(rows: ReportRow[] = [], respond?: () => Response) {
  const seen: { calls: number; url: URL | null } = { calls: 0, url: null };

  server.use(
    http.get(REPORTS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Liste getirildi.",
        httpStatus: "200 OK",
        path: "/admin/reports",
        requestId: "rid-reports",
        timeStamp: "2026-09-06T09:30:00.000000000Z",
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

/**
 * Render the page and drop React's `<!-- -->` text separators.
 *
 * Fizz inserts them between adjacent interpolations, so a sentence built from
 * `{count} kez` arrives as `<!-- -->2<!-- --> kez`. Asserting around them would
 * pin a React implementation detail rather than the sentence an operator reads.
 */
const render = async (params: Record<string, string> = {}) =>
  (await renderServerComponent(<ReportsPage searchParams={Promise.resolve(params)} />)).replaceAll(
    "<!-- -->",
    "",
  );

const renderDetail = async (id: string = row().id) =>
  (await renderServerComponent(<ReportDetailPage params={Promise.resolve({ id })} />)).replaceAll(
    "<!-- -->",
    "",
  );

function watchDetail(
  report: ReportRow = row(),
  content: unknown = { jobTitle: null, messageBody: null, imageUrl: null },
) {
  server.use(
    http.get(`${REPORTS}/:reportId`, () =>
      HttpResponse.json({
        success: true,
        message: "Şikayet getirildi.",
        httpStatus: "200 OK",
        path: `/admin/reports/${report.id}`,
        requestId: "rid-detail",
        timeStamp: "2026-09-06T09:32:00.000000000Z",
        data: { report, content },
      }),
    ),
  );
}

describe("who can see the queue", () => {
  it("refuses a CATALOG_EDITOR and never asks the backend for reports", async () => {
    stubMe(CATALOG_EDITOR, ["CATALOG_EDITOR"]);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("İçerik denetle");
    // The header still names the page that refused them.
    expect(html).toContain("Şikayet inceleme kuyruğu");
    expect(html).not.toContain("Mesajlarda hakaret etti.");
  });

  it("refuses a DISPUTE_HANDLER, which is the whole point of the permission choice", async () => {
    stubMe(DISPUTE_HANDLER, ["DISPUTE_HANDLER"]);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
  });

  it("lets content.moderate through and makes the request the others never made", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(html).not.toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Taciz");
    expect(html).toContain(`/reports/${row().id}`);
  });
});

describe("the filter and the page are query parameters", () => {
  it("asks for OPEN, page 0 and the backend's default sort when the URL says nothing", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);

    await render();

    expect(queue.url?.searchParams.get("status")).toBe("OPEN");
    expect(queue.url?.searchParams.get("page")).toBe("0");
    expect(queue.url?.searchParams.get("size")).toBe("20");
    expect(queue.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("turns the URL's filter, page and sort into the request", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row({ status: "ACTIONED" })]);

    await render({ durum: "ACTIONED", sayfa: "2", boyut: "50", sirala: "createdAt,asc" });

    expect(queue.url?.searchParams.get("status")).toBe("ACTIONED");
    expect(queue.url?.searchParams.get("page")).toBe("2");
    expect(queue.url?.searchParams.get("size")).toBe("50");
    expect(queue.url?.searchParams.get("sort")).toBe("createdAt,asc");
  });

  it("falls back rather than sending a status Spring cannot bind", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([]);

    await render({ durum: "MUZ" });

    expect(queue.url?.searchParams.get("status")).toBe("OPEN");
  });

  it("does not advertise missing filters as unfinished work", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Durum ve sıralama kuyruğu süzer");
    expect(html).not.toContain("Backend&#x27;in veremedikleri");
  });
});

describe("what the queue shows", () => {
  it("puts the date, status, reason and target of every report in the table", async () => {
    stubMe(MODERATOR);
    watchQueue([row({ messageId: "bbbbbbbb-0000-4000-8000-000000000002" })]);

    const html = await render();

    expect(html).toContain("01.09.2026");
    expect(html).toContain("Açık");
    expect(html).toContain("Taciz");
    expect(html).toContain("Kullanıcı");
    expect(html).toContain("Mesaj");
  });

  it("distinguishes an empty status from a failure", async () => {
    // An error state here would send an operator chasing a backend that is
    // fine; an empty table where the backend refused would be worse still.
    stubMe(MODERATOR);
    watchQueue([]);

    const html = await render();

    expect(html).toContain("durumunda şikayet yok");
    expect(html).not.toContain("Backend bu işlem için yetki vermedi.");
  });

  it("renders the backend's 403 rather than crashing when the gate opened anyway", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([], () =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: "/admin/reports",
          timeStamp: "2026-09-06T09:31:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(html).toContain("Backend bu işlem için yetki vermedi.");
    expect(html).toContain("rid-403");
  });
});

describe("the detail, and what it refuses to make up", () => {
  it("shows the reason, the text and every target identifier", async () => {
    stubMe(MODERATOR);
    watchDetail(row({ imageId: "cccccccc-0000-4000-8000-000000000003" }));

    const html = await renderDetail();

    expect(html).toContain("Mesajlarda hakaret etti.");
    expect(html).toContain("aaaaaaaa-0000-4000-8000-000000000001");
    expect(html).toContain("cccccccc-0000-4000-8000-000000000003");
  });

  it("names the reporter and the table-wide prior count from the DTO", async () => {
    stubMe(MODERATOR);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain("Şikayet eden");
    expect(html).toContain("Ayşe Kaya");
    expect(html).toContain("Berk Yılmaz");
    expect(html).toContain("Geçmiş şikayet");
    expect(html).toContain("3");
    expect(html).not.toContain("Backend döndürmüyor");
    expect(html).not.toContain("Aynı kullanıcı bu sayfada");
  });

  it("links the reported user to their object page and a bookmarkable reports filter", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain(`/users/${REPORTED.id}`);
    expect(html).toContain(`/users/${REPORTER.id}`);
    expect(html).not.toContain("Aynı kullanıcı bu sayfada 2 kez");
  });

  it("sends reportedUserId when the URL asks to group that user", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);

    await render({ kullanici: REPORTED.id });

    expect(queue.url?.searchParams.get("reportedUserId")).toBe(REPORTED.id);
  });
});

/** koala-admin#99: ilan bağlantısı, mesaj kimliği ve denetim izi. */
describe("the report's job, message and audit pointer", () => {
  const JOB = "bbbbbbbb-0000-4000-8000-000000000002";
  const MESSAGE = "eeeeeeee-0000-4000-8000-000000000005";

  it("links the job only to a job.read holder and keeps the id visible either way", async () => {
    stubMe(MODERATOR);
    watchDetail(row({ jobId: JOB }), {
      jobTitle: "Akşam barista",
      messageBody: null,
      imageUrl: null,
    });
    const alone = await renderDetail();
    expect(alone).not.toContain(`href="/jobs/${JOB}"`);
    expect(alone).toContain("Akşam barista");
    expect(alone).toContain(JOB);

    stubMe([...MODERATOR, "job.read"]);
    watchDetail(row({ jobId: JOB }), {
      jobTitle: "Akşam barista",
      messageBody: null,
      imageUrl: null,
    });
    const both = await renderDetail();
    expect(both).toContain(`href="/jobs/${JOB}"`);
    expect(both).toMatch(new RegExp(`<a[^>]*href="/jobs/${JOB}"[^>]*>Akşam barista</a>`));
  });

  it("falls back to the job id as the link text when the content has no title", async () => {
    stubMe([...MODERATOR, "job.read"]);
    watchDetail(row({ jobId: JOB }));

    const html = await renderDetail();

    expect(html).toMatch(new RegExp(`<a[^>]*href="/jobs/${JOB}"[^>]*>${JOB}</a>`));
  });

  it("writes the message id in mono", async () => {
    stubMe(MODERATOR);
    watchDetail(row({ messageId: MESSAGE }));

    const html = await renderDetail();

    expect(html).toMatch(new RegExp(`Mesaj kimliği</dt><dd class="font-mono[^"]*">${MESSAGE}<`));
  });

  it("omits the job and message rows when the report names neither", async () => {
    stubMe(MODERATOR);
    watchDetail(row());

    const html = await renderDetail();

    expect(html).not.toContain("Mesaj kimliği");
    expect(html).not.toMatch(/>İlan<\/dt>/);
  });

  it("points at the audit log filtered to this report, only for an audit.read holder", async () => {
    stubMe(MODERATOR);
    watchDetail(row());
    const alone = await renderDetail();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...MODERATOR, "audit.read"]);
    watchDetail(row());
    const html = await renderDetail();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${row().id}"`);
  });
});

describe("a bookmarked report", () => {
  it("loads GET /admin/reports/{id} and shows the targeted content", async () => {
    stubMe(MODERATOR);
    const seen: string[] = [];
    server.use(
      http.get(`${REPORTS}/:reportId`, ({ params }) => {
        seen.push(String(params.reportId));
        return HttpResponse.json({
          success: true,
          message: "Şikayet getirildi.",
          httpStatus: "200 OK",
          path: `/admin/reports/${row().id}`,
          requestId: "rid-detail",
          timeStamp: "2026-09-06T09:32:00.000000000Z",
          data: {
            report: row({ jobId: "bbbbbbbb-0000-4000-8000-000000000002" }),
            content: {
              jobTitle: "Akşam barista",
              messageBody: "Gelme, nakit ödeyeceğiz.",
              imageUrl: "https://cdn.example/reported.jpg",
            },
          },
        });
      }),
    );

    const html = await renderDetail(row().id);

    expect(seen).toEqual([row().id]);
    expect(html).toContain("Akşam barista");
    expect(html).toContain("Gelme, nakit ödeyeceğiz.");
    expect(html).toContain("https://cdn.example/reported.jpg");
  });

  it("does not invent a detail request when the URL has no id", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);
    let detailCalls = 0;
    server.use(
      http.get(`${REPORTS}/:reportId`, () => {
        detailCalls += 1;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await render();

    expect(detailCalls).toBe(0);
  });
});

describe("the decision", () => {
  it("offers haklı, haksız and ek bilgi, each with what it will do", async () => {
    stubMe(MODERATOR);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain("Haklı bulundu");
    expect(html).toContain("Haksız bulundu");
    expect(html).toContain("Ek bilgi bekleniyor");
    expect(html).toContain("Bu karar ne yapacak?");
  });

  it("requires a written reason and says the rule is the panel's, not the backend's", async () => {
    stubMe(MODERATOR);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain("Karar gerekçesi");
    expect(html).toContain("En az");
  });

  it("closes the form on a report the backend would answer 409 for", async () => {
    stubMe(MODERATOR);
    watchDetail(
      row({
        status: "ACTIONED",
        reviewNote: "Kayıtlar doğruladı.",
        reviewedAt: "2026-09-02T10:00:00Z",
      }),
    );

    const html = await renderDetail();

    expect(html).toContain("olarak sonuçlandırılmış");
    expect(html).toContain("Kayıtlar doğruladı.");
    expect(html).not.toContain("Kararı gönder");
  });

  it("says a verdict does not remove content or close an account", async () => {
    stubMe(MODERATOR);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain("Bu karar içeriği kaldırmaz ve hesabı kapatmaz");
    expect(html).not.toContain("henüz yok");
    expect(html).not.toContain("kapsam dışı");
    expect(html).not.toContain("Görseli kaldır");
  });

  it("offers image removal only when the report names an IMAGE target", async () => {
    stubMe(MODERATOR);
    watchDetail(row({ imageId: "cccccccc-0000-4000-8000-000000000003" }));

    const html = await renderDetail();

    expect(html).toContain("Görseli kaldır");
    expect(html).toContain("cccccccc-0000-4000-8000-000000000003");
    expect(html).not.toContain("henüz yok");
  });

  it("keeps the image-removal notice after the redirect refresh", async () => {
    stubMe(MODERATOR);
    watchDetail(row({ imageId: null }));

    const html = (
      await renderServerComponent(
        <ReportDetailPage
          params={Promise.resolve({ id: row().id })}
          searchParams={Promise.resolve({ sonuc: "gorsel-kaldirildi" })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).toContain("Görsel kaldırıldı");
    expect(html).toContain("galerilerinden düştü");
  });
});

describe("unfinished-work copy stays off the screen", () => {
  it("does not list backend gaps on a loaded or failed queue", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);
    const loaded = await render();
    expect(loaded).not.toContain("Backend&#x27;in veremedikleri");

    server.resetHandlers();
    stubMe(MODERATOR);
    watchQueue([], () => HttpResponse.error());
    const failed = await render();
    expect(failed).toContain("Şikayet kuyruğu yüklenemedi.");
    expect(failed).not.toContain("Backend&#x27;in veremedikleri");
  });
});

/**
 * koala-admin#85. Backend'in `REPORT_NOT_FOUND`u ortak 404 yüzeyidir. Öteki
 * 404 — `ENDPOINT_NOT_FOUND`, ucun kendisinin yokluğu — değildir: o bir
 * dağıtım sorunudur ve istek numarasıyla uyarı olarak kalır, çünkü "kayıt
 * silinmiş" operatörü hiç olmamış bir silmeyi aramaya gönderirdi.
 *
 * Son test sırayı sabitler: `notFound()` kapının *içinde* çalışır. İzni
 * olmayan kişi bozuk bir id ile de 403 görür ve hiçbir istek çıkmaz; Next'in
 * "notFound()'u her await'ten önce koyun" öğüdü çağrıyı kapının üstüne
 * taşımaya davet eder ve bu test o taşımayı kırmızıya çevirir.
 */
describe("a report that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(MODERATOR);
    let calls = 0;
    server.use(
      http.get(`${REPORTS}/:reportId`, () => {
        calls += 1;
        return HttpResponse.json(resourceNotFoundBody, { status: 404 });
      }),
    );

    const thrown = await renderDetail().then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(MODERATOR);
    let calls = 0;
    server.use(
      http.get(`${REPORTS}/:reportId`, () => {
        calls += 1;
        return HttpResponse.json(resourceNotFoundBody, { status: 404 });
      }),
    );

    const thrown = await renderDetail("not-a-uuid").then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("keeps a missing endpoint as a load failure with its request id", async () => {
    stubMe(MODERATOR);
    server.use(
      http.get(`${REPORTS}/:reportId`, () =>
        HttpResponse.json(
          { ...endpointNotFoundBody, path: `/admin/reports/${row().id}` },
          { status: 404 },
        ),
      ),
    );

    const html = await renderDetail();

    expect(html).toContain("Şikayet detayı yüklenemedi.");
    expect(html).toContain("ENDPOINT_NOT_FOUND");
    expect(html).toContain(endpointNotFoundBody.requestId);
  });

  it("answers a malformed id with the permission gate, not the 404, when the actor lacks content.moderate", async () => {
    stubMe(CATALOG_EDITOR, ["CATALOG_EDITOR"]);
    let calls = 0;
    server.use(
      http.get(`${REPORTS}/:reportId`, () => {
        calls += 1;
        return HttpResponse.json(resourceNotFoundBody, { status: 404 });
      }),
    );

    const outcome = await renderDetail("not-a-uuid").then(
      (html) => ({ html, thrown: null as unknown }),
      (error: unknown) => ({ html: null, thrown: error }),
    );

    expect(outcome.thrown).toBeNull();
    expect(calls).toBe(0);
    expect(outcome.html).toContain("403 — Bu sayfa için yetkiniz yok");
  });
});

describe("the search box — koala-admin#94", () => {
  it("sends ara to the backend as query, next to the status, and names it in the result line", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);

    const html = await render({ ara: " berk ", durum: "OPEN" });

    expect(queue.url?.searchParams.get("query")).toBe("berk");
    expect(queue.url?.searchParams.get("status")).toBe("OPEN");
    expect(html).toContain("“berk” için 1 şikayet bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("offers Temizle, which drops ara but keeps status, sort and the user filter", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render({ ara: "berk", durum: "ACTIONED", kullanici: REPORTED.id });

    expect(html).toContain(
      `href="/reports?durum=ACTIONED&amp;sirala=createdAt%2Cdesc&amp;boyut=20&amp;kullanici=${REPORTED.id}"`,
    );
    expect(html).toContain("Temizle");
  });

  it("says there is no result for the query rather than that the status is empty", async () => {
    stubMe(MODERATOR);
    watchQueue([]);

    const html = await render({ ara: "kimse" });

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html).not.toContain("durumunda şikayet yok.");
  });

  it("shows the backend's 400 for an over-long query inline", async () => {
    stubMe(MODERATOR);
    watchQueue([], () =>
      HttpResponse.json(searchQueryTooLongBody("/admin/reports"), { status: 400 }),
    );

    const html = await render({ ara: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Şikayet kuyruğu yüklenemedi.");
  });
});

/** koala-admin#100 / koala-backend#283: şikayet eden süzgeci, atama bağlantısı, kararı veren personel. */
describe("the reporter filter, the assignment link and the deciding staff member", () => {
  const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";

  it("sends sikayetci as reporterId, alone or together with reportedUserId", async () => {
    stubMe(MODERATOR);
    const alone = watchQueue([row()]);
    const html = await render({ sikayetci: REPORTER.id });
    expect(alone.url?.searchParams.get("reporterId")).toBe(REPORTER.id);
    expect(alone.url?.searchParams.has("reportedUserId")).toBe(false);
    expect(html).toContain("açtığı şikayetleri süzüyor");

    const both = watchQueue([row()]);
    const bothHtml = await render({ sikayetci: REPORTER.id, kullanici: REPORTED.id });
    expect(both.url?.searchParams.get("reporterId")).toBe(REPORTER.id);
    expect(both.url?.searchParams.get("reportedUserId")).toBe(REPORTED.id);
    // İki süzgeç iki ayrı kişiyi gösterebilir; cümle "bir kullanıcının" demez.
    expect(bothHtml).toContain("şikayet edilene ve şikayet edene göre");
    expect(bothHtml).toContain("ikisi ayrı kişiler olabilir");
    expect(bothHtml).not.toContain("bir kullanıcının hem");
  });

  it("sends no status for durum=hepsi and offers Tümü in the filter", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);

    const html = await render({ durum: "hepsi", kullanici: REPORTED.id });

    expect(queue.url?.searchParams.has("status")).toBe(false);
    expect(queue.url?.searchParams.get("reportedUserId")).toBe(REPORTED.id);
    expect(html).toContain('<option value="hepsi" selected="">Tümü</option>');
    expect(html).toContain('data-testid="report-user-filter"');
  });

  it("drops a reporter id that is not a UUID before it reaches the backend", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);
    await render({ sikayetci: "not-a-uuid" });
    expect(queue.url?.searchParams.has("reporterId")).toBe(false);
  });

  it("links the assignment only to a payment.read holder and keeps the id visible either way", async () => {
    stubMe(MODERATOR);
    watchDetail(row({ jobAssignmentId: ASSIGNMENT }));
    const alone = await renderDetail();
    expect(alone).toContain(ASSIGNMENT);
    expect(alone).not.toContain(`href="/assignments/${ASSIGNMENT}"`);

    stubMe([...MODERATOR, "payment.read"]);
    watchDetail(row({ jobAssignmentId: ASSIGNMENT }));
    const both = await renderDetail();
    expect(both).toContain(`href="/assignments/${ASSIGNMENT}"`);
  });

  it("draws the deciding staff id next to the reviewer and omits both rows for a #265 server", async () => {
    stubMe(MODERATOR);
    const staff = stubStaffMember();
    watchDetail(
      row({
        status: "ACTIONED",
        reviewedBy: REPORTER,
        reviewedByStaffId: STAFF_ID,
        reviewNote: "Mesajlar doğrulandı.",
        reviewedAt: "2026-09-02T08:00:00Z",
      }),
    );
    const decided = await renderDetail();
    // staff.read yok: kısa kimlik, bağlantısız, istek yok (koala-admin#112).
    expect(staff.ids).toEqual([]);
    expect(decided).toMatch(
      new RegExp(`Kararı veren personel</dt><dd[^>]*><span[^>]*title="${STAFF_ID}">5f000000<`),
    );
    expect(decided).not.toContain("#personel-");

    stubMe(MODERATOR);
    watchDetail(row());
    const legacy = await renderDetail();
    expect(legacy).not.toContain("Kararı veren personel");
    expect(legacy).not.toMatch(/>Atama</);
  });
});

/** koala-admin#112: personel adı `staff.read` ile, kırıntı süzgeçle. */
describe("the deciding staff member's name and the report breadcrumb", () => {
  it("resolves reviewedByStaffId to a linked name for a staff.read holder", async () => {
    stubMe([...MODERATOR, "staff.read"]);
    const staff = stubStaffMember();
    watchDetail(row({ status: "ACTIONED", reviewedByStaffId: STAFF_ID }));

    const html = await renderDetail();

    expect(staff.ids).toEqual([STAFF_ID]);
    expect(html).toContain(`href="${STAFF_HREF.replaceAll("&", "&amp;")}"`);
    expect(html).toContain(`title="${STAFF_ID}">${STAFF_NAME}<`);
  });

  it("writes Şikayetler › short id and carries the queue view back", async () => {
    stubMe(MODERATOR);
    watchDetail();

    const html = (
      await renderServerComponent(
        <ReportDetailPage
          params={Promise.resolve({ id: row().id })}
          searchParams={Promise.resolve({ durum: "OPEN", kullanici: REPORTED.id, sayfa: "1" })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).toContain('<nav aria-label="Konum">');
    expect(html).toContain(
      `href="/reports?durum=OPEN&amp;sayfa=1&amp;kullanici=${REPORTED.id}"><span>Şikayetler</span>`,
    );
    expect(html).toContain(
      `aria-current="page" class="text-ink"><span class="font-mono text-xs" title="${row().id}">11111111<`,
    );
  });
});

/** koala-admin#110: tarih aralığı `createdAt` üzerinde backend'e gider; CSV bağlantısı görünümü taşır. */
describe("the date range and the CSV link — koala-admin#110", () => {
  it("turns baslangic/bitis into Istanbul day boundaries alongside the status filter", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([]);

    const html = await render({ durum: "ACTIONED", baslangic: "2026-09-01", bitis: "2026-09-14" });

    expect(queue.url?.searchParams.get("status")).toBe("ACTIONED");
    expect(queue.url?.searchParams.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(queue.url?.searchParams.get("to")).toBe("2026-09-14T20:59:59.999Z");
    expect(html).toContain('data-testid="sikayet-tarih-summary"');
    expect(html).toContain("Bu tarih aralığında şikayet yok.");
    expect(html).toContain('data-testid="reports-export"');
    expect(html).toContain(
      'href="/api/export/reports?durum=ACTIONED&amp;sirala=createdAt%2Cdesc&amp;baslangic=2026-09-01&amp;bitis=2026-09-14"',
    );
  });

  it("drops a day that is not a calendar day before it reaches the backend", async () => {
    stubMe(MODERATOR);
    const queue = watchQueue([row()]);

    const html = await render({ bitis: "2026-02-30" });

    expect(queue.url?.searchParams.has("to")).toBe(false);
    expect(html).not.toContain('data-testid="sikayet-tarih-summary"');
  });
});
