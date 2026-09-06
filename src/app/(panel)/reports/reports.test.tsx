import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
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

interface ReportRow {
  id: string;
  reportedUserId: string | null;
  jobId: string | null;
  messageId: string | null;
  imageId: string | null;
  reason: string;
  description: string | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  createdAt: string;
}

function row(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    reportedUserId: "aaaaaaaa-0000-4000-8000-000000000001",
    jobId: null,
    messageId: null,
    imageId: null,
    reason: "HARASSMENT",
    description: "Mesajlarda hakaret etti.",
    status: "OPEN",
    reviewNote: null,
    reviewedAt: null,
    createdAt: "2026-09-01T08:00:00Z",
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
        correlationId: "cid-reports",
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
    expect(html).toContain("Mesajlarda hakaret etti.");
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

  it("says out loud that reason and reporter cannot be filtered at all", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Şikayet türüne, gerekçeye ya da şikayet edene göre süzme yok");
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
          correlationId: "cid-403",
          path: "/admin/reports",
          timeStamp: "2026-09-06T09:31:00.000000000Z",
        },
        { status: 403 },
      ),
    );

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(html).toContain("Backend bu işlem için yetki vermedi.");
    expect(html).toContain("cid-403");
  });
});

describe("the detail, and what it refuses to make up", () => {
  it("shows the reason, the text and every target identifier", async () => {
    stubMe(MODERATOR);
    watchQueue([row({ imageId: "cccccccc-0000-4000-8000-000000000003" })]);

    const html = await render();

    expect(html).toContain("Mesajlarda hakaret etti.");
    expect(html).toContain("aaaaaaaa-0000-4000-8000-000000000001");
    expect(html).toContain("cccccccc-0000-4000-8000-000000000003");
  });

  it("says the reporter is not returned instead of showing a blank field", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Şikayet eden");
    expect(html).toContain("Backend döndürmüyor.");
  });

  it("refuses to invent a prior-report count", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Geçmiş şikayet sayısı");
    expect(html).toContain("panel bir sayı uydurmuyor");
  });

  it("marks repeats on the page as page-scoped, never as a total", async () => {
    // Grouping needs a filter by reported user, which the endpoint does not
    // have. A count over twenty rows presented as a total is a lie an operator
    // would act on, so the words "bu sayfada" are part of the contract.
    stubMe(MODERATOR);
    watchQueue([
      row({ id: "11111111-1111-4111-8111-111111111111" }),
      row({ id: "22222222-2222-4222-8222-222222222222", description: "Yine aynı kişi." }),
    ]);

    const html = await render();

    expect(html).toContain("Aynı kullanıcı bu sayfada 2 kez");
    expect(html).toContain("kuyruğun tamamı için bir");
  });
});

describe("the decision", () => {
  it("offers haklı, haksız and ek bilgi, each with what it will do", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Haklı bulundu");
    expect(html).toContain("Haksız bulundu");
    expect(html).toContain("Ek bilgi bekleniyor");
    expect(html).toContain("Bu karar ne yapacak?");
  });

  it("requires a written reason and says the rule is the panel's, not the backend's", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Karar gerekçesi");
    expect(html).toContain("Backend boş not kabul ediyor; bu kural panelin.");
  });

  it("closes the form on a report the backend would answer 409 for", async () => {
    stubMe(MODERATOR);
    watchQueue([
      row({
        status: "ACTIONED",
        reviewNote: "Kayıtlar doğruladı.",
        reviewedAt: "2026-09-02T10:00:00Z",
      }),
    ]);

    const html = await render();

    expect(html).toContain("olarak sonuçlandırılmış");
    expect(html).toContain("Kayıtlar doğruladı.");
    expect(html).not.toContain("Kararı gönder");
  });

  it("names the follow-up steps, including the ones that have no endpoint", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("koala-backend&#x27;de böyle bir uç yok");
    expect(html).toContain("kapsam dışı");
  });

  it("names the image takedown endpoint only when the report is about an image", async () => {
    stubMe(MODERATOR);
    watchQueue([row({ reportedUserId: null, imageId: "cccccccc-0000-4000-8000-000000000003" })]);

    const withImage = await render();
    expect(withImage).toContain("ucu var");

    server.resetHandlers();
    stubMe(MODERATOR);
    watchQueue([row()]);

    const withoutImage = await render();
    expect(withoutImage).toContain("uygulanabilir bir kaldırma adımı yok");
  });
});

describe("the gaps are on the screen, not only in a hand-off note", () => {
  it("lists what ReportsController cannot answer", async () => {
    stubMe(MODERATOR);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("Backend&#x27;in veremedikleri");
    expect(html).toContain("Tek bir şikayeti getiren uç yok");
  });

  it("still lists them when the queue itself could not be loaded", async () => {
    stubMe(MODERATOR);
    watchQueue([], () => HttpResponse.error());

    const html = await render();

    expect(html).toContain("Şikayet kuyruğu yüklenemedi.");
    expect(html).toContain("Backend&#x27;in veremedikleri");
  });
});
