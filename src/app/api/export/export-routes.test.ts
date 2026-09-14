import { HttpResponse, http, type JsonBodyType } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminAssignmentFixture } from "../../../../test/fixtures/admin-assignment";
import { envelope } from "../../../../test/fixtures/admin-detail";
import {
  adminMeNoStaffRecordBody,
  adminMeSuccessBody,
  searchQueryTooLongBody,
} from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { StaffAuthError } from "@/server/auth/errors";
import { EXPORT_AUDIT_PREFIX } from "@/server/export/csv-export";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { GET: exportAssignments } = await import("./assignments/route");
const { GET: exportPayouts } = await import("./payouts/route");
const { GET: exportReports } = await import("./reports/route");
const { GET: exportDisputes } = await import("./disputes/route");

/**
 * CSV rotaları (koala-admin#110): oturum + sayfa izni, mevcut süzgeçle ilk
 * 1000 satır, UTF-8 BOM, ad sütunları yalnız `user.read_pii` ile, denetim
 * günlüğü satırı. Backend'e giden adres sayfanınkiyle aynı olmalı — o
 * iddia ancak isteğin kendisi okunarak sınanır.
 */

const ASSIGNMENTS = apiUrl("/admin/job-assignments");
const PAYOUTS = apiUrl("/admin/payouts");
const REPORTS = apiUrl("/admin/reports");
const DISPUTES = apiUrl("/admin/disputes");
const WORKER_ID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

function request(path: string, query = "") {
  return new Request(`http://admin.iskoala.test${path}${query}`);
}

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(apiUrl("/admin/me"), () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

function page(content: unknown[], overrides: Record<string, unknown> = {}): JsonBodyType {
  return envelope("/admin/list", {
    content,
    page: 0,
    size: content.length,
    totalElements: content.length,
    totalPages: 1,
    first: true,
    last: true,
    ...overrides,
  });
}

function watch(url: string, respond: (url: URL, call: number) => JsonBodyType) {
  const seen: { urls: URL[]; authorization: string | null } = { urls: [], authorization: null };
  server.use(
    http.get(url, ({ request: upstream }) => {
      const current = new URL(upstream.url);
      seen.urls.push(current);
      seen.authorization = upstream.headers.get("authorization");
      return HttpResponse.json(respond(current, seen.urls.length));
    }),
  );
  return seen;
}

let info: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  info = vi.spyOn(console, "info").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

describe("the gate in front of every export", () => {
  it("answers 401 without a session and never calls the backend", async () => {
    getKoalaAccessToken.mockRejectedValue(
      new StaffAuthError("SESSION_REQUIRED", "Oturum çerezi yok."),
    );
    const seen = watch(ASSIGNMENTS, () => page([]));

    const response = await exportAssignments(request("/api/export/assignments"));

    expect(response.status).toBe(401);
    expect(seen.urls).toHaveLength(0);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers 403 when the token has no staff record", async () => {
    server.use(
      http.get(apiUrl("/admin/me"), () =>
        HttpResponse.json(adminMeNoStaffRecordBody, { status: 403 }),
      ),
    );

    const response = await exportAssignments(request("/api/export/assignments"));

    expect(response.status).toBe(403);
  });

  it("refuses a staff member without the page's permission before any list request", async () => {
    stubMe(["dispute.resolve"]);
    const seen = watch(ASSIGNMENTS, () => page([adminAssignmentFixture()]));

    const response = await exportAssignments(request("/api/export/assignments"));

    expect(response.status).toBe(403);
    expect(await response.text()).toContain("yetkiniz yok");
    expect(seen.urls).toHaveLength(0);
    expect(info).not.toHaveBeenCalled();
  });

  it("treats a /admin/me outage as 502, not as a missing permission", async () => {
    server.use(http.get(apiUrl("/admin/me"), () => HttpResponse.text("down", { status: 503 })));

    const response = await exportAssignments(request("/api/export/assignments"));

    expect(response.status).toBe(502);
  });
});

describe("GET /api/export/assignments", () => {
  it("writes a BOM, a header, one row per assignment, and names the file as an attachment", async () => {
    stubMe(["payment.read"]);
    const seen = watch(ASSIGNMENTS, () => page([adminAssignmentFixture()]));

    const response = await exportAssignments(request("/api/export/assignments"));
    // `Response.text()` BOM'u soyar; dosyaya inen bayt dizisi burada okunur.
    const bytes = new Uint8Array(await response.arrayBuffer());
    const text = new TextDecoder("utf-8", { ignoreBOM: true }).decode(bytes);

    expect(response.status).toBe(200);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(response.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="atamalar-\d{4}-\d{2}-\d{2}\.csv"$/,
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(text.charCodeAt(0)).toBe(0xfeff);

    const lines = text.slice(1).split("\r\n");
    expect(lines[0]).toContain('"Atama kimliği","İlan kimliği","İlan başlığı"');
    expect(lines[0]).toContain('"Şirket kimliği","Şirket adı"');
    expect(lines[1]).toContain('"9a1c0f10-0001-4c00-8000-0000000000aa"');
    expect(lines[1]).toContain('"Garsonluk"');
    expect(lines[1]).toContain('"c0000000-0000-4000-8000-0000000000c1","Koala Kafe"');
    expect(lines[1]).toContain('"COMPLETED","HELD_IN_ESCROW"');
    expect(lines[1]).toContain('"1240.50","137.83","1378.33","TRY"');
    expect(lines.at(-1)).toBe("");
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(text).not.toContain("ACCESS-TOKEN");
  });

  it("leaves the name columns out without user.read_pii and writes them with it", async () => {
    stubMe(["payment.read"]);
    watch(ASSIGNMENTS, () => page([adminAssignmentFixture()]));
    const withoutPii = await (await exportAssignments(request("/api/export/assignments"))).text();

    expect(withoutPii).not.toContain("İşçi adı");
    expect(withoutPii).not.toContain("Ayşe Yılmaz");
    expect(withoutPii).toContain('"w-1"');

    stubMe(["payment.read", "user.read_pii"]);
    const withPii = await (await exportAssignments(request("/api/export/assignments"))).text();

    expect(withPii).toContain('"İşçi kimliği","İşçi adı","İşveren kimliği","İşveren adı"');
    expect(withPii).toContain('"w-1","Ayşe Yılmaz","e-1","Mehmet Demir"');
  });

  it("forwards the page's own filters — status list, date range, party, search, sort", async () => {
    stubMe(["payment.read"]);
    const seen = watch(ASSIGNMENTS, () => page([]));

    await exportAssignments(
      request(
        "/api/export/assignments",
        `?durum=CONFIRMED,IN_PROGRESS&baslangic=2026-09-01&bitis=2026-09-14&isci=${WORKER_ID}&ara=garson&sirala=assignmentDateTime,asc&sayfa=7&boyut=5`,
      ),
    );

    expect(seen.urls).toHaveLength(1);
    const params = seen.urls[0]?.searchParams;
    expect(params?.get("status")).toBe("CONFIRMED,IN_PROGRESS");
    expect(params?.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(params?.get("to")).toBe("2026-09-14T20:59:59.999Z");
    expect(params?.get("workerId")).toBe(WORKER_ID);
    expect(params?.get("query")).toBe("garson");
    expect(params?.get("sort")).toBe("assignmentDateTime,asc");
    // Dışa aktarma ilk sayfadan başlar ve backend'in tavanını ister; `sayfa`/`boyut` yok sayılır.
    expect(params?.get("page")).toBe("0");
    expect(params?.get("size")).toBe("100");
  });

  it("drops an unknown status and a malformed day before they reach the backend", async () => {
    stubMe(["payment.read"]);
    const seen = watch(ASSIGNMENTS, () => page([]));

    await exportAssignments(request("/api/export/assignments", "?durum=banana&baslangic=dün"));

    const params = seen.urls[0]?.searchParams;
    expect(params?.has("status")).toBe(false);
    expect(params?.has("from")).toBe(false);
  });

  it("pages until the backend says last, and stops at 1000 rows", async () => {
    stubMe(["payment.read"]);
    const rowsOf = (count: number, prefix: string) =>
      Array.from({ length: count }, (_, index) =>
        adminAssignmentFixture({ id: `${prefix}-${index}` }),
      );
    const seen = watch(ASSIGNMENTS, (url) => {
      const current = Number(url.searchParams.get("page"));
      return page(rowsOf(100, `p${current}`), {
        page: current,
        totalElements: 1500,
        totalPages: 15,
        first: current === 0,
        last: false,
      });
    });

    const text = await (await exportAssignments(request("/api/export/assignments"))).text();

    expect(seen.urls).toHaveLength(10);
    expect(seen.urls.map((url) => url.searchParams.get("page"))).toEqual([
      "0",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ]);
    const lines = text.split("\r\n").filter((line) => line.length > 0);
    expect(lines).toHaveLength(1001);
  });

  it("stops early when a page comes back last", async () => {
    stubMe(["payment.read"]);
    const seen = watch(ASSIGNMENTS, (url) => {
      const current = Number(url.searchParams.get("page"));
      return page([adminAssignmentFixture({ id: `p${current}` })], {
        page: current,
        totalElements: 2,
        totalPages: 2,
        first: current === 0,
        last: current === 1,
      });
    });

    const text = await (await exportAssignments(request("/api/export/assignments"))).text();

    expect(seen.urls).toHaveLength(2);
    expect(text.split("\r\n").filter((line) => line.length > 0)).toHaveLength(3);
  });

  it("writes one audit line naming the staff member, the list, the filters and the row count", async () => {
    stubMe(["payment.read", "user.read_pii"]);
    watch(ASSIGNMENTS, () => page([adminAssignmentFixture()]));

    await exportAssignments(
      request("/api/export/assignments", "?durum=COMPLETED&baslangic=2026-09-01"),
    );

    expect(info).toHaveBeenCalledTimes(1);
    const line = String(info.mock.calls[0]?.[0]);
    expect(line.startsWith(EXPORT_AUDIT_PREFIX)).toBe(true);
    expect(line).toContain("list=assignments");
    expect(line).toContain(`staffId=${adminMeSuccessBody.data.staffId}`);
    expect(line).toContain("rows=1");
    expect(line).toContain("pii=true");
    expect(line).toContain('filters="durum=COMPLETED&baslangic=2026-09-01"');
    expect(line).not.toContain("ACCESS-TOKEN");
  });

  it("turns the backend's over-long search 400 into a 400 and any other failure into 502", async () => {
    stubMe(["payment.read"]);
    server.use(
      http.get(ASSIGNMENTS, () =>
        HttpResponse.json(searchQueryTooLongBody("/admin/job-assignments"), { status: 400 }),
      ),
    );
    expect((await exportAssignments(request("/api/export/assignments", "?ara=uzun"))).status).toBe(
      400,
    );

    server.use(http.get(ASSIGNMENTS, () => HttpResponse.text("boom", { status: 500 })));
    expect((await exportAssignments(request("/api/export/assignments"))).status).toBe(502);
    expect(info).not.toHaveBeenCalled();
  });
});

describe("the other three lists", () => {
  it("payouts: payout.reconcile, page size 50, durum=hepsi sends all four statuses, dates forwarded", async () => {
    stubMe(["payment.read"]);
    expect((await exportPayouts(request("/api/export/payouts"))).status).toBe(403);

    stubMe(["payout.reconcile"]);
    const seen = watch(PAYOUTS, () =>
      page([
        {
          id: "9c000000-0000-4000-8000-000000000033",
          jobAssignmentId: "9a1c0f10-0001-4c00-8000-0000000000aa",
          recipient: { id: WORKER_ID, firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
          amount: "1240.50",
          currency: "TRY",
          status: "PROCESSING",
          failureReason: null,
          completedAt: null,
          createdAt: "2026-09-10T09:00:00Z",
        },
      ]),
    );

    const response = await exportPayouts(
      request("/api/export/payouts", "?durum=hepsi&bitis=2026-09-14"),
    );
    const text = await response.text();

    expect(response.headers.get("content-disposition")).toContain('filename="hakedisler-');
    const params = seen.urls[0]?.searchParams;
    expect(params?.get("status")).toBe("PENDING,PROCESSING,COMPLETED,FAILED");
    expect(params?.get("to")).toBe("2026-09-14T20:59:59.999Z");
    expect(params?.get("size")).toBe("50");
    expect(text).toContain('"Hakediş kimliği","Atama kimliği","Alıcı kimliği","Tutar"');
    expect(text).toContain(`"${WORKER_ID}","1240.50","TRY","PROCESSING"`);
    expect(text).not.toContain("Ayşe");
  });

  it("payouts: without durum the status parameter stays off so the backend keeps its PROCESSING default", async () => {
    stubMe(["payout.reconcile"]);
    const seen = watch(PAYOUTS, () => page([]));

    await exportPayouts(request("/api/export/payouts"));

    expect(seen.urls[0]?.searchParams.has("status")).toBe(false);
  });

  it("reports: content.moderate, OPEN by default, hepsi drops status, dates forwarded", async () => {
    stubMe(["content.moderate"]);
    const seen = watch(REPORTS, () =>
      page([
        {
          id: "5e000000-0000-4000-8000-000000000051",
          reporter: { id: WORKER_ID, firstName: "Ayşe", lastName: "Yılmaz" },
          reportedUser: null,
          reportedUserId: "e-1",
          jobId: null,
          jobAssignmentId: null,
          messageId: null,
          imageId: null,
          reason: "SPAM",
          description: '=HYPERLINK("http://kotu")',
          status: "OPEN",
          reviewedBy: null,
          reviewedByStaffId: null,
          reviewNote: null,
          reviewedAt: null,
          createdAt: "2026-09-10T09:00:00Z",
          reportedUserReportCount: 3,
        },
      ]),
    );

    const first = await (await exportReports(request("/api/export/reports"))).text();
    expect(seen.urls[0]?.searchParams.get("status")).toBe("OPEN");
    expect(first).toContain('"Şikayet kimliği","Oluşturulma","Durum","Neden"');
    expect(first).toContain('"\'=HYPERLINK(""http://kotu"")"');
    expect(first).toContain('"e-1"');
    expect(first).not.toContain("Ayşe");

    await exportReports(request("/api/export/reports", "?durum=hepsi&baslangic=2026-09-01"));
    expect(seen.urls[1]?.searchParams.has("status")).toBe(false);
    expect(seen.urls[1]?.searchParams.get("from")).toBe("2026-08-31T21:00:00.000Z");

    stubMe(["payment.read"]);
    expect((await exportReports(request("/api/export/reports"))).status).toBe(403);
  });

  it("disputes: dispute.resolve, pending queue by default, RESOLVED forwarded with dates", async () => {
    stubMe(["dispute.resolve", "user.read_pii"]);
    const seen = watch(DISPUTES, () =>
      page([
        {
          id: "6d000000-0000-4000-8000-000000000061",
          jobAssignmentId: "9a1c0f10-0001-4c00-8000-0000000000aa",
          openedBy: { id: WORKER_ID, firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
          openedBySide: "WORKER",
          status: "OPEN",
          reason: "Ödeme gelmedi",
          resolution: null,
          resolutionNote: null,
          resolvedByStaffId: null,
          resolvedAt: null,
          createdAt: "2026-09-10T09:00:00Z",
        },
      ]),
    );

    const text = await (await exportDisputes(request("/api/export/disputes"))).text();
    expect(seen.urls[0]?.searchParams.has("status")).toBe(false);
    expect(text).toContain('"Uyuşmazlık kimliği","Atama kimliği","Açan kimliği","Açan adı"');
    expect(text).toContain(`"${WORKER_ID}","Ayşe Yılmaz","WORKER","OPEN"`);

    await exportDisputes(
      request("/api/export/disputes", "?durum=RESOLVED&baslangic=2026-09-01&bitis=2026-09-14"),
    );
    const params = seen.urls[1]?.searchParams;
    expect(params?.get("status")).toBe("RESOLVED");
    expect(params?.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(params?.get("to")).toBe("2026-09-14T20:59:59.999Z");

    stubMe(["content.moderate"]);
    expect((await exportDisputes(request("/api/export/disputes"))).status).toBe(403);
  });
});
