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

const render = async (params: Record<string, string> = {}) =>
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
  it("sends q to the backend as query and names it in the result line", async () => {
    stubMe(ANALYST);
    const list = watchList();

    const html = await render({ q: " garson " });

    expect(list.url?.searchParams.get("query")).toBe("garson");
    expect(html).toContain("“garson” için 1 atama bulundu.");
    expect(html).toContain('name="q"');
  });

  it("offers Temizle, which drops q and keeps the page size", async () => {
    stubMe(ANALYST);
    watchList();

    const html = await render({ q: "garson", boyut: "50" });

    expect(html).toContain('href="/assignments?boyut=50"');
    expect(html).toContain("Temizle");
  });

  it("keeps the search when a row is opened by id", async () => {
    stubMe(ANALYST);
    watchList();

    const html = await render({ q: "garson" });

    expect(html).toContain(`/assignments?atama=${ASSIGNMENT_ID}&amp;q=garson`);
  });

  it("says there is no result for the query", async () => {
    stubMe(ANALYST);
    watchList([]);

    const html = await render({ q: "kimse" });

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

    const html = await render({ q: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Atama kuyruğu yüklenemedi.");
  });
});
