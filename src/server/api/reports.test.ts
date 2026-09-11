import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { readPaging } from "./paging";
import {
  REPORT_PAGING,
  getReport,
  getReports,
  reportReasonLabel,
  reportStatusLabel,
  reportTargets,
  reviewReport,
  type Report,
} from "./reports";

/**
 * The claim under test is a URL.
 *
 * koala-admin#7 requires the queue's filters and paging to be applied by the
 * backend. A test that rendered a table and counted rows could not tell that
 * apart from a page that fetched everything and sliced it, so these assertions
 * are about the request the panel makes and nothing else.
 */

const REPORTS = apiUrl("/admin/reports");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Captures the URL and headers of the queue call, and answers with one page. */
function watchQueue(content: Partial<Report>[] = []) {
  const seen: { url: URL | null; authorization: string | null } = {
    url: null,
    authorization: null,
  };

  server.use(
    http.get(REPORTS, ({ request }) => {
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "Liste getirildi.",
        httpStatus: "200 OK",
        path: "/admin/reports",
        requestId: "rid-reports",
        timeStamp: "2026-09-06T09:30:00.000000000Z",
        data: {
          content,
          page: 0,
          size: 20,
          totalElements: content.length,
          totalPages: 1,
          first: true,
          last: true,
        },
      });
    }),
  );

  return seen;
}

describe("the queue asks the backend for the page it is showing", () => {
  it("sends the status filter, the page, the size and the sort as query parameters", async () => {
    const seen = watchQueue();

    await getReports("ACCESS-TOKEN", {
      status: "UNDER_REVIEW",
      paging: readPaging({ sayfa: "2", boyut: "50", sirala: "status,asc" }, REPORT_PAGING),
    });

    const params = seen.url?.searchParams;
    expect(params?.get("status")).toBe("UNDER_REVIEW");
    expect(params?.get("page")).toBe("2");
    expect(params?.get("size")).toBe("50");
    expect(params?.get("sort")).toBe("status,asc");
  });

  it("defaults to the backend's own page size and sort", async () => {
    const seen = watchQueue();

    await getReports("ACCESS-TOKEN", { status: "OPEN", paging: readPaging({}, REPORT_PAGING) });

    expect(seen.url?.searchParams.get("size")).toBe("20");
    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("never sends a sort field ReportManager would reject", async () => {
    // `rejectUnknownSort` throws for anything outside {createdAt, status}.
    const seen = watchQueue();

    await getReports("ACCESS-TOKEN", {
      status: "OPEN",
      paging: readPaging({ sirala: "reportedUserId,asc" }, REPORT_PAGING),
    });

    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("carries the staff access token", async () => {
    const seen = watchQueue();

    await getReports("ACCESS-TOKEN", { status: "OPEN", paging: readPaging({}, REPORT_PAGING) });

    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
  });

  it("returns the page the backend sent, row for row", async () => {
    // The other half of "no filtering on the client": what comes back is what
    // is rendered, so a mismatch here would show up as a row count.
    watchQueue([
      {
        id: "r-1",
        reportedUserId: "u-1",
        jobId: null,
        messageId: null,
        imageId: null,
        reason: "HARASSMENT",
        description: "Küfür etti.",
        status: "OPEN",
        reviewNote: null,
        reviewedAt: null,
        createdAt: "2026-09-01T08:00:00Z",
      },
    ]);

    const page = await getReports("ACCESS-TOKEN", {
      status: "OPEN",
      paging: readPaging({}, REPORT_PAGING),
    });

    expect(page.content).toHaveLength(1);
    expect(page.content[0]?.reason).toBe("HARASSMENT");
  });

  it("keeps a reason the panel has never heard of instead of failing the page", async () => {
    // A moderation queue that renders empty because the backend added an enum
    // member is the worst possible failure mode for this screen.
    watchQueue([
      {
        id: "r-2",
        reportedUserId: "u-9",
        jobId: null,
        messageId: null,
        imageId: null,
        reason: "IMPERSONATION",
        description: null,
        status: "OPEN",
        reviewNote: null,
        reviewedAt: null,
        createdAt: "2026-09-01T08:00:00Z",
      },
    ]);

    const page = await getReports("ACCESS-TOKEN", {
      status: "OPEN",
      paging: readPaging({}, REPORT_PAGING),
    });

    expect(page.content[0]?.reason).toBe("IMPERSONATION");
    expect(reportReasonLabel("IMPERSONATION")).toBe("IMPERSONATION");
  });

  it("sends reportedUserId when grouping the same target", async () => {
    const seen = watchQueue();

    await getReports("ACCESS-TOKEN", {
      status: "OPEN",
      reportedUserId: "aaaaaaaa-0000-4000-8000-000000000001",
      paging: readPaging({}, REPORT_PAGING),
    });

    expect(seen.url?.searchParams.get("reportedUserId")).toBe(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
  });

  it("omits reportedUserId rather than sending an empty filter", async () => {
    const seen = watchQueue();

    await getReports("ACCESS-TOKEN", {
      status: "OPEN",
      paging: readPaging({}, REPORT_PAGING),
    });

    expect(seen.url?.searchParams.has("reportedUserId")).toBe(false);
  });

  it("keeps the reporter identity and the prior-count the backend sent", async () => {
    watchQueue([
      {
        id: "r-1",
        reporter: {
          id: "rep-1",
          firstName: "Ayşe",
          lastName: "Kaya",
          username: "ayse",
          profilePictureUrl: null,
        },
        reportedUser: {
          id: "u-1",
          firstName: "Berk",
          lastName: "Yılmaz",
          username: "berk",
          profilePictureUrl: null,
        },
        reportedUserId: "u-1",
        jobId: null,
        messageId: null,
        imageId: null,
        reason: "HARASSMENT",
        description: "Küfür etti.",
        status: "OPEN",
        reviewNote: null,
        reviewedAt: null,
        createdAt: "2026-09-01T08:00:00Z",
        reportedUserReportCount: 3,
      },
    ]);

    const page = await getReports("ACCESS-TOKEN", {
      status: "OPEN",
      paging: readPaging({}, REPORT_PAGING),
    });

    expect(page.content[0]?.reporter?.firstName).toBe("Ayşe");
    expect(page.content[0]?.reportedUserReportCount).toBe(3);
  });
});

describe("opening one report", () => {
  it("asks GET /admin/reports/{id} for the content preview", async () => {
    let href: string | null = null;
    server.use(
      http.get(`${REPORTS}/:reportId`, ({ request }) => {
        href = request.url;
        return HttpResponse.json({
          success: true,
          message: "Şikayet getirildi.",
          httpStatus: "200 OK",
          path: "/admin/reports/r-1",
          requestId: "rid-detail",
          timeStamp: "2026-09-06T09:32:00.000000000Z",
          data: {
            report: {
              id: "r-1",
              reporter: {
                id: "rep-1",
                firstName: "Ayşe",
                lastName: "Kaya",
                username: "ayse",
                profilePictureUrl: null,
              },
              reportedUser: null,
              reportedUserId: null,
              jobId: "job-1",
              messageId: null,
              imageId: null,
              reason: "SPAM",
              description: null,
              status: "OPEN",
              reviewNote: null,
              reviewedAt: null,
              createdAt: "2026-09-01T08:00:00Z",
              reportedUserReportCount: 0,
            },
            content: {
              jobTitle: "Akşam barista",
              messageBody: null,
              imageUrl: null,
            },
          },
        });
      }),
    );

    const detail = await getReport("ACCESS-TOKEN", "r-1");

    expect(href).toContain("/admin/reports/r-1");
    expect(detail.report.id).toBe("r-1");
    expect(detail.content.jobTitle).toBe("Akşam barista");
  });

  it("escapes the report id on the detail path", async () => {
    let url: string | null = null;
    server.use(
      http.get(`${REPORTS}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await getReport("ACCESS-TOKEN", "../me").catch(() => undefined);

    expect(url).toContain("%2F");
  });
});

describe("submitting a verdict", () => {
  it("posts the decision and the written reason to the review endpoint", async () => {
    let body: unknown = null;
    let url: string | null = null;

    server.use(
      http.post(`${REPORTS}/:reportId/review`, async ({ request }) => {
        url = request.url;
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Şikayet sonuçlandırıldı.",
          httpStatus: "200 OK",
          path: "/admin/reports/r-1/review",
          requestId: "rid-review",
          timeStamp: "2026-09-06T09:31:00.000000000Z",
          data: {
            id: "r-1",
            reportedUserId: "u-1",
            jobId: null,
            messageId: null,
            imageId: null,
            reason: "HARASSMENT",
            description: "Küfür etti.",
            status: "ACTIONED",
            reviewNote: "Mesaj kayıtları doğruladı.",
            reviewedAt: "2026-09-06T09:31:00Z",
            createdAt: "2026-09-01T08:00:00Z",
          },
        });
      }),
    );

    const reviewed = await reviewReport("ACCESS-TOKEN", "r-1", {
      status: "ACTIONED",
      note: "Mesaj kayıtları doğruladı.",
    });

    expect(url).toBe(`${REPORTS}/r-1/review`);
    expect(body).toEqual({ status: "ACTIONED", note: "Mesaj kayıtları doğruladı." });
    expect(reviewed.status).toBe("ACTIONED");
  });

  it("escapes the report id rather than pasting it into a path", async () => {
    let url: string | null = null;
    server.use(
      http.post(`${REPORTS}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await reviewReport("ACCESS-TOKEN", "../me", { status: "ACTIONED", note: "x" }).catch(
      () => undefined,
    );

    expect(url).toContain("%2F");
  });
});

describe("what a report points at", () => {
  const base: Report = {
    id: "r-1",
    reporter: null,
    reportedUser: null,
    reportedUserId: null,
    jobId: null,
    messageId: null,
    imageId: null,
    reason: "SPAM",
    description: null,
    status: "OPEN",
    reviewedBy: null,
    reviewNote: null,
    reviewedAt: null,
    createdAt: "2026-09-01T08:00:00Z",
    reportedUserReportCount: 0,
  };

  it("lists every target, because one report can name more than one", () => {
    // `CreateReportDto` only requires at least one of the four; a report about
    // a message names the sender too, and hiding that hides the evidence.
    expect(reportTargets({ ...base, reportedUserId: "u-1", messageId: "m-1" })).toEqual([
      { kind: "USER", id: "u-1" },
      { kind: "MESSAGE", id: "m-1" },
    ]);
  });

  it("is empty only when the backend sent a report pointing at nothing", () => {
    expect(reportTargets(base)).toEqual([]);
  });
});

describe("labels", () => {
  it("translates the statuses the queue filters on", () => {
    expect(reportStatusLabel("OPEN")).toBe("Açık");
    expect(reportStatusLabel("ACTIONED")).toBe("Haklı bulundu");
    expect(reportStatusLabel("DISMISSED")).toBe("Reddedildi");
  });

  it("shows an unknown status as its code rather than as a blank cell", () => {
    expect(reportStatusLabel("ESCALATED")).toBe("ESCALATED");
  });
});
