import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminAssignmentFixture } from "../../../../test/fixtures/admin-assignment";
import { adminMeSuccessBody, searchQueryTooLongBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: AssignmentsPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const ASSIGNMENT_ID = "9a1c0f10-0001-4c00-8000-0000000000aa";
const LIST = apiUrl("/admin/job-assignments");
const LOOKUP = apiUrl(`/admin/job-assignments/${ASSIGNMENT_ID}`);

const ANALYST = ["payment.read"];
const MODERATOR = ["dispute.resolve"];

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["FINANCE_ANALYST"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function pageEnvelope(content: unknown[]) {
  return {
    success: true,
    message: "Atamalar listelendi.",
    httpStatus: "200 OK",
    path: "/admin/job-assignments",
    requestId: "rid-assignment-list",
    timeStamp: "2026-09-11T13:00:00.000000000Z",
    data: {
      content,
      page: 0,
      size: 20,
      totalElements: content.length,
      totalPages: 1,
      first: true,
      last: true,
    },
  };
}

function watchList(content: unknown[] = [adminAssignmentFixture()]) {
  const seen: { calls: number; authorization: string | null; url: URL | null } = {
    calls: 0,
    authorization: null,
    url: null,
  };

  server.use(
    http.get(LIST, ({ request }) => {
      const url = new URL(request.url);
      if (
        url.pathname !== "/admin/job-assignments" &&
        !url.pathname.endsWith("/admin/job-assignments")
      ) {
        return;
      }
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      seen.url = url;
      return HttpResponse.json(pageEnvelope(content));
    }),
  );

  return seen;
}

function watchLookup(data: unknown = adminAssignmentFixture()) {
  const seen: { calls: number; authorization: string | null; url: URL | null } = {
    calls: 0,
    authorization: null,
    url: null,
  };

  server.use(
    http.get(LOOKUP, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      seen.url = new URL(request.url);
      return HttpResponse.json({
        success: true,
        message: "Atama özeti getirildi.",
        httpStatus: "200 OK",
        path: `/admin/job-assignments/${ASSIGNMENT_ID}`,
        requestId: "rid-assignment",
        timeStamp: "2026-09-11T13:00:00.000000000Z",
        data,
      });
    }),
  );

  return seen;
}

const render = async (params: Record<string, string | string[]> = {}) =>
  (
    await renderServerComponent(<AssignmentsPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

describe("who can look up an assignment", () => {
  it("refuses a DISPUTE_HANDLER without payment.read and never asks the backend", async () => {
    stubMe(MODERATOR, ["DISPUTE_HANDLER"]);
    const lookup = watchLookup();

    const html = await render({ atama: ASSIGNMENT_ID });

    expect(lookup.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Ödemeleri görüntüle");
    expect(html).not.toContain("Ayşe Yılmaz");
    expect(html).not.toContain("₺1.240,50");
  });

  it("lets payment.read through and keeps the bearer token on the server", async () => {
    stubMe(ANALYST);
    const list = watchList();
    const lookup = watchLookup();

    const html = await render({ atama: ASSIGNMENT_ID });

    expect(list.calls).toBe(1);
    expect(list.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(lookup.calls).toBe(0);
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("Koala Kafe");
    expect(html).toContain("Garsonluk");
    expect(html).toContain("₺1.240,50");
    expect(html).toContain("%10");
    expect(html).toContain("₺137,83");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("8 sa");
    expect(html).not.toContain("ACCESS-TOKEN");
  });
});

describe("the queue and the UUID lookup", () => {
  it("pages the list when the form is empty and does not look up a UUID", async () => {
    stubMe(ANALYST);
    const list = watchList();
    const lookup = watchLookup();

    const html = await render();

    expect(list.calls).toBe(1);
    expect(lookup.calls).toBe(0);
    expect(html).toContain("Atama kimliği");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).not.toContain("Liste yoktur");
    expect(html).not.toContain("listelenmez");
  });

  it("does not look up a malformed UUID", async () => {
    stubMe(ANALYST);
    watchList();
    const lookup = watchLookup();

    const html = await render({ atama: "not-a-uuid" });

    expect(lookup.calls).toBe(0);
    expect(html).toContain("Geçerli bir atama kimliği girin.");
  });
});

describe("the safe user projection and missing records", () => {
  it("does not render an email even if the payload carries one", async () => {
    stubMe(ANALYST);
    const assignment = adminAssignmentFixture();
    watchList([
      {
        ...assignment,
        worker: { ...assignment.worker, email: "private-worker@koala.test" },
        employer: { ...assignment.employer, email: "private-employer@koala.test" },
      },
    ]);

    const html = await render({ atama: ASSIGNMENT_ID });

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).not.toContain("private-worker@koala.test");
    expect(html).not.toContain("private-employer@koala.test");
  });

  it("renders the backend 404 in operator language rather than crashing", async () => {
    stubMe(ANALYST);
    watchList([]);
    const seen: { calls: number } = { calls: 0 };

    server.use(
      http.get(LOOKUP, () => {
        seen.calls += 1;
        return HttpResponse.json(
          {
            success: false,
            message: "İş ataması bulunamadı.",
            httpStatus: "404 NOT_FOUND",
            errorCode: "JOB_ASSIGNMENT_NOT_FOUND",
            errorCategory: "RESOURCE_NOT_FOUND",
            requestId: "rid-404",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}`,
            timeStamp: "2026-09-11T13:00:00.000000000Z",
          },
          { status: 404 },
        );
      }),
    );

    const html = await render({ atama: ASSIGNMENT_ID });

    expect(seen.calls).toBe(1);
    expect(html).toContain("Atama özeti yüklenemedi.");
    expect(html).toContain("İş ataması bulunamadı.");
    expect(html).toContain("JOB_ASSIGNMENT_NOT_FOUND");
    expect(html).toContain("rid-404");
  });
});

describe("the search box — koala-admin#94", () => {
  it("sends ara to the backend as query and names it in the result line", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ ara: " garson " });

    expect(list.url?.searchParams.get("query")).toBe("garson");
    expect(html).toContain("“garson” için 1 atama bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("offers Temizle, which drops ara and keeps the page size", async () => {
    stubMe(ANALYST);
    watchList();

    const html = await render({ ara: "garson", boyut: "50" });

    expect(html).toContain('href="/assignments?boyut=50"');
    expect(html).toContain("Temizle");
  });

  it("links the row to the assignment's own page (koala-admin#95)", async () => {
    stubMe(ANALYST);
    watchList();

    const html = await render({ ara: "garson" });

    // Satır bağlantısı liste görünümünü taşır (koala-admin#112); `atama` süzgeç değil, taşınmaz.
    expect(html).toContain(
      `href="/assignments/${ASSIGNMENT_ID}?boyut=20&amp;ara=garson&amp;sayfa=0"`,
    );
    expect(html).not.toContain(`/assignments?atama=${ASSIGNMENT_ID}`);
  });

  it("links the inline UUID summary to the same page", async () => {
    stubMe(ANALYST);
    watchList();

    const html = await render({ atama: ASSIGNMENT_ID });

    expect(html).toContain("Detayı aç");
    expect(html).toContain(`href="/assignments/${ASSIGNMENT_ID}"`);
  });

  it("says there is no result for the query", async () => {
    stubMe(ANALYST);
    watchList([]);

    const html = await render({ ara: "kimse" });

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html).not.toContain("Atama yok.");
  });

  it("shows the backend's 400 for an over-long query inline", async () => {
    stubMe(ANALYST);
    server.use(
      http.get(LIST, () =>
        HttpResponse.json(searchQueryTooLongBody("/admin/job-assignments"), { status: 400 }),
      ),
    );

    const html = await render({ ara: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Atama kuyruğu yüklenemedi.");
  });
});

/** koala-admin#100: `?isci=` / `?isveren=` backend'in `workerId` / `employerId` süzgeçlerine gider. */
describe("the party filters — koala-admin#100", () => {
  const WORKER = "aaaaaaaa-0000-4000-8000-000000000001";
  const EMPLOYER = "bbbbbbbb-0000-4000-8000-000000000002";

  it("sends isci as workerId and isveren as employerId, and offers to drop them", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ isci: WORKER, isveren: EMPLOYER, boyut: "10" });

    expect(list.url?.searchParams.get("workerId")).toBe(WORKER);
    expect(list.url?.searchParams.get("employerId")).toBe(EMPLOYER);
    expect(html).toContain('data-testid="assignment-party-filter"');
    expect(html).toContain(WORKER);
    expect(html).toContain(EMPLOYER);
    expect(html).toContain('href="/assignments?boyut=10"');
  });

  it("sends only workerId when the URL names a worker and names the empty result", async () => {
    stubMe(ANALYST);
    const list = watchList([]);

    const html = await render({ isci: WORKER });

    expect(list.url?.searchParams.get("workerId")).toBe(WORKER);
    expect(list.url?.searchParams.has("employerId")).toBe(false);
    expect(html).toContain("Bu kullanıcının bu roldeki ataması yok.");
  });

  it("drops a party id that is not a UUID before it reaches the backend", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ isci: "not-a-uuid" });

    expect(list.url?.searchParams.has("workerId")).toBe(false);
    expect(html).not.toContain('data-testid="assignment-party-filter"');
  });
});

/** koala-admin#105: satırdaki her ad tıklanır; ilan ve şirket bağlantısı izne bakar. */
describe("every name in the row is a link — koala-admin#105", () => {
  const WORKER = "aaaaaaaa-0000-4000-8000-000000000001";
  const EMPLOYER = "bbbbbbbb-0000-4000-8000-000000000002";
  const COMPANY = "c0000000-0000-4000-8000-0000000000c1";
  const JOB = "9a1c0f10-0001-4c00-8000-0000000000bb";
  const withUuidParties = () =>
    adminAssignmentFixture({
      worker: {
        id: WORKER,
        firstName: "Ayşe",
        lastName: "Yılmaz",
        username: "ayse",
        profilePictureUrl: null,
      },
      employer: {
        id: EMPLOYER,
        firstName: "Mehmet",
        lastName: "Demir",
        username: "mehmet",
        profilePictureUrl: null,
      },
    });

  it("links worker and employer to their user pages, job and company only with their permissions", async () => {
    stubMe(["payment.read", "job.read", "company.approve"]);
    watchList([withUuidParties()]);

    const html = await render();

    expect(html).toContain(`href="/users/${WORKER}"`);
    expect(html).toContain(`href="/users/${EMPLOYER}"`);
    expect(html).toContain(`href="/jobs/${JOB}"`);
    expect(html).toContain(`href="/companies/${COMPANY}"`);
    expect(html).toContain("Koala Kafe");
  });

  it("keeps job and company as plain text without job.read / company.approve", async () => {
    stubMe(ANALYST);
    watchList([withUuidParties()]);

    const html = await render();

    expect(html).toContain(`href="/users/${WORKER}"`);
    expect(html).not.toContain(`href="/jobs/${JOB}"`);
    expect(html).not.toContain(`href="/companies/${COMPANY}"`);
    expect(html).toContain("Garsonluk");
    expect(html).toContain("Koala Kafe");
  });

  it("writes the company name as text when an older backend sends no companyId", async () => {
    stubMe(["payment.read", "company.approve"]);
    const { companyId: _dropped, ...legacy } = adminAssignmentFixture();
    watchList([legacy]);

    const html = await render();

    expect(html).toContain("Koala Kafe");
    expect(html).not.toContain("/companies/");
  });
});

/** koala-admin#110: durum (çoklu) ve tarih aralığı backend'e gider; CSV bağlantısı görünümü taşır. */
describe("status, date range and CSV — koala-admin#110", () => {
  it("sends the checked statuses as one comma list and keeps them in the pager and export link", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ durum: ["IN_PROGRESS", "CONFIRMED"], boyut: "10" });

    expect(list.url?.searchParams.get("status")).toBe("CONFIRMED,IN_PROGRESS");
    expect(html).toContain('data-testid="assignment-status-filter"');
    expect(html).toContain('name="durum" checked="" value="CONFIRMED"');
    expect(html).toContain('name="durum" checked="" value="IN_PROGRESS"');
    expect(html).not.toContain('checked="" value="COMPLETED"');
    expect(html).toContain('name="durum" value="CONFIRMED,IN_PROGRESS"');
    expect(html).toContain('href="/api/export/assignments?durum=CONFIRMED%2CIN_PROGRESS"');
    expect(html).toContain('data-testid="assignment-status-clear"');
  });

  it("sends nothing as status when no box is checked and drops an unknown value", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ durum: "banana" });

    expect(list.url?.searchParams.has("status")).toBe(false);
    expect(html).not.toContain('data-testid="assignment-status-clear"');
  });

  it("turns baslangic/bitis into Istanbul day boundaries and names the range", async () => {
    stubMe(ANALYST);
    const list = watchList([]);

    const html = await render({ baslangic: "2026-09-01", bitis: "2026-09-14" });

    expect(list.url?.searchParams.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(list.url?.searchParams.get("to")).toBe("2026-09-14T20:59:59.999Z");
    expect(html).toContain('data-testid="atama-tarih-summary"');
    expect(html).toContain("01.09.2026 – 14.09.2026");
    expect(html).toContain("Bu süzgeçlere uyan atama yok.");
    expect(html).toContain('data-testid="atama-tarih-clear"');
    expect(html).toContain(
      'href="/api/export/assignments?baslangic=2026-09-01&amp;bitis=2026-09-14"',
    );
  });

  it("drops a day that is not a calendar day before it reaches the backend", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ baslangic: "2026-02-30", bitis: "dün" });

    expect(list.url?.searchParams.has("from")).toBe(false);
    expect(list.url?.searchParams.has("to")).toBe(false);
    expect(html).not.toContain('data-testid="atama-tarih-summary"');
  });

  it("carries the other filters through the export link and leaves paging out", async () => {
    stubMe(ANALYST);
    watchList();
    const WORKER = "aaaaaaaa-0000-4000-8000-000000000001";

    const html = await render({ isci: WORKER, ara: "garson", sayfa: "3", boyut: "10" });

    expect(html).toContain('data-testid="assignments-export"');
    expect(html).toContain(`href="/api/export/assignments?ara=garson&amp;isci=${WORKER}"`);
  });
});
