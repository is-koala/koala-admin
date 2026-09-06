import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  auditPageBody,
  categoryCreatedEntry,
  erasedDetailEntry,
  refusedEntry,
} from "../../../../test/fixtures/audit-log";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * The audit viewer end to end, from a URL's query string to the request the
 * server makes.
 *
 * `gate.test.tsx` owns the permission story and still does — it is untouched by
 * this slice and asserts the request *count* is zero for a CATALOG_EDITOR. What
 * this file adds is the rest of koala-admin#10's acceptance list, and the two
 * assertions that matter most are both about requests rather than markup:
 *
 *  - the filters a person typed appear on the outgoing request, so the backend
 *    does the filtering;
 *  - no second request happens while the page sits open.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: AuditLogPage } = await import("@/app/(panel)/audit-log/page");

const ADMIN_ME = apiUrl("/admin/me");
const AUDIT_LOG = apiUrl("/admin/audit-log");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: ["OWNER"], permissions: ["audit.read"] },
      }),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

/** Records every audit request the render made, in order. */
function watchAuditLog(body: object = auditPageBody()) {
  const seen: URL[] = [];

  server.use(
    http.get(AUDIT_LOG, ({ request }) => {
      seen.push(new URL(request.url));
      return HttpResponse.json(body);
    }),
  );

  return seen;
}

/**
 * React's SSR splits adjacent text nodes with `<!-- -->` markers, which is
 * invisible on screen and noise in an assertion. Stripped so these tests read
 * like the sentence a person sees.
 */
async function renderPage(searchParams: Record<string, string> = {}): Promise<string> {
  const html = await renderServerComponent(
    <AuditLogPage searchParams={Promise.resolve(searchParams)} />,
  );
  return html.replaceAll("<!-- -->", "");
}

/** The opening tag of one element, so assertions do not depend on attribute order. */
function openingTag(html: string, tag: string, testId: string): string {
  const match = new RegExp(`<${tag}[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  if (match === null) throw new Error(`${testId} render edilmedi.`);
  return match[0];
}

describe("the filters a person typed go to the backend", () => {
  it("puts the actor and the date range on the outgoing request", async () => {
    // koala-admin#10's acceptance criterion, stated as the test it asks for.
    const seen = watchAuditLog();

    await renderPage({ actor: "Katalog Editörü", from: "2026-09-01", to: "2026-09-06" });

    expect(seen).toHaveLength(1);
    const query = seen[0]?.searchParams;
    expect(query?.get("actor")).toBe("Katalog Editörü");
    expect(query?.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(query?.get("to")).toBe("2026-09-06T20:59:59.999Z");
  });

  it("carries the whole filter set, including the refused-only view", async () => {
    const seen = watchAuditLog();

    await renderPage({
      action: "job-category.delete",
      permission: "category.manage",
      resourceType: "job-category",
      resourceId: "9a1c0f10-0001-4c00-8000-000000000005",
      allowed: "false",
      page: "2",
    });

    const query = seen[0]?.searchParams;
    expect(query?.get("action")).toBe("job-category.delete");
    expect(query?.get("permission")).toBe("category.manage");
    expect(query?.get("resourceType")).toBe("job-category");
    expect(query?.get("resourceId")).toBe("9a1c0f10-0001-4c00-8000-000000000005");
    expect(query?.get("allowed")).toBe("false");
    expect(query?.get("page")).toBe("2");
  });

  it("renders every row the server returned, without re-filtering the page", async () => {
    // The mistake koala-admin#10 names: the mobile app fetches GET /jobs with
    // no arguments and filters twenty rows on the device. Here the server was
    // asked for allowed-only and answered with a refused row in the page; the
    // panel renders what it was given rather than quietly correcting it, which
    // is what keeps the screen an honest view of the request that was made.
    watchAuditLog(auditPageBody({ content: [categoryCreatedEntry, refusedEntry] }));

    const html = await renderPage({ allowed: "true" });

    expect(html).toContain(categoryCreatedEntry.resourceId);
    expect(html).toContain(refusedEntry.resourceId);
  });

  it("submits the filter form to the server as a GET, not to a client handler", async () => {
    watchAuditLog();

    const html = await renderPage({ actor: "Katalog Editörü" });

    // A GET form's submission *is* the query string this page reads, so there
    // is no browser state that can drift from what was actually asked.
    const form = openingTag(html, "form", "audit-filters");
    expect(form).toContain('method="get"');
    expect(form).toContain('action="/audit-log"');
    expect(html).toContain('value="Katalog Editörü"');
  });

  it("keeps the active filters on the pager, so page two is still filtered", async () => {
    watchAuditLog(
      auditPageBody({ content: [categoryCreatedEntry], page: 0, totalElements: 87, totalPages: 4 }),
    );

    const html = await renderPage({ actor: "Katalog Editörü", allowed: "true" });

    // Hidden inputs, because a pager that dropped them would turn a filtered
    // table into an unfiltered one on the way to page two.
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="actor"/);
    expect(html).toMatch(/<input[^>]*type="hidden"[^>]*name="allowed"/);
    expect(html).toContain("Sayfa 1 / 4");
    expect(html).toContain("87 kayıt");
  });
});

describe("an empty table says which kind of empty it is", () => {
  it("says the log is empty when nothing was filtered", async () => {
    watchAuditLog(auditPageBody({ content: [] }));

    const html = await renderPage({});

    expect(html).toContain("Denetim kaydı boş.");
    expect(html).not.toContain("Filtreye uyan kayıt yok.");
  });

  it("says the filter matched nothing when a filter was applied", async () => {
    // Told apart on purpose. Collapsing the two is how an operator whose date
    // range was a day off concludes the action was never logged — a false
    // negative in the one table that is supposed to settle that question.
    watchAuditLog(auditPageBody({ content: [] }));

    const html = await renderPage({ actor: "Yok Böyle Biri" });

    expect(html).toContain("Filtreye uyan kayıt yok.");
    expect(html).not.toContain("Denetim kaydı boş.");
    // And a way back out of the filter that found nothing.
    expect(html).toContain("Filtreleri temizle");
  });
});

describe("what the table shows", () => {
  it("shows a refused attempt with its actor and the permission that refused it", async () => {
    // koala-admin#10's second acceptance criterion: the CATALOG_EDITOR-less
    // attempt is visible as `allowed = false`.
    watchAuditLog(auditPageBody({ content: [refusedEntry] }));

    const html = await renderPage({});

    expect(html).toContain('data-allowed="false"');
    expect(html).toContain("Reddedildi");
    expect(html).toContain("Destek Uzmanı");
    expect(html).toContain("category.manage");
  });

  it("shows a created category with the actor's name and the permission", async () => {
    // The first acceptance criterion, from the [04] screen's side.
    watchAuditLog(auditPageBody({ content: [categoryCreatedEntry] }));

    const html = await renderPage({});

    expect(html).toContain("job-category.create");
    expect(html).toContain("Katalog Editörü");
    expect(html).toContain("category.manage");
    expect(html).toContain("İzin verildi");
  });

  it("prints absolute Istanbul timestamps, never a relative one", async () => {
    watchAuditLog(auditPageBody({ content: [categoryCreatedEntry, erasedDetailEntry] }));

    const html = await renderPage({});

    expect(html).toContain("06.09.2026 09:20:31");
    expect(html).toContain("01.03.2026 14:05:44");
    expect(html).not.toMatch(/\d+ (dakika|saat|gün) önce/);
  });
});

describe("nothing refreshes on its own", () => {
  it("makes exactly one request per render and none afterwards", async () => {
    const seen = watchAuditLog(auditPageBody({ content: [categoryCreatedEntry] }));

    await renderPage({});
    expect(seen).toHaveLength(1);

    // The page is now sitting on someone's screen. Reading this table is itself
    // an audited, sensitive read (koala-backend#15), so a refresh loop would
    // fill the log with rows about itself being read.
    await new Promise((resolve) => setTimeout(resolve, 250));
    expect(seen).toHaveLength(1);
  });

  it("offers a manual Yenile that stays on the page being read", async () => {
    watchAuditLog(auditPageBody({ content: [categoryCreatedEntry], page: 3, totalElements: 87 }));

    const html = await renderPage({ page: "3" });

    expect(html).toContain("Yenile");
    // It carries the page being read, so a refresh does not jump to page one.
    const refresh = openingTag(html, "button", "audit-refresh");
    expect(refresh).toContain('name="page"');
    expect(refresh).toContain('value="3"');
  });
});
