import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  JOB_ID,
  adminJobDetailFixture,
  adminJobFixture,
  envelope,
  pageEnvelope,
} from "../../../../test/fixtures/admin-detail";
import {
  adminMeSuccessBody,
  resourceNotFoundBody,
  searchQueryTooLongBody,
} from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: JobsPage } = await import("./page");
const { default: JobDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const JOBS = apiUrl("/admin/jobs");
const JOB = apiUrl(`/admin/jobs/${JOB_ID}`);
const PLAN = apiUrl(`/admin/jobs/${JOB_ID}/transport-plan`);

const AGENT = ["job.read"];

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["SUPPORT_AGENT"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watchList(rows: unknown[] = [adminJobFixture()]) {
  const seen = { calls: 0, url: null as URL | null, authorization: null as string | null };
  server.use(
    http.get(JOBS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(pageEnvelope("/admin/jobs", rows));
    }),
  );
  return seen;
}

function planNotFoundBody() {
  return {
    ...resourceNotFoundBody,
    errorCode: "TRANSPORT_PLAN_NOT_FOUND",
    path: `/admin/jobs/${JOB_ID}/transport-plan`,
    resource: "transport-plan",
    resourceId: JOB_ID,
  };
}

function watchDetail(
  job: unknown = adminJobDetailFixture(),
  plan: unknown | "missing" = "missing",
) {
  const seen = { calls: 0, planCalls: 0 };
  server.use(
    http.get(JOB, () => {
      seen.calls += 1;
      return HttpResponse.json(envelope(`/admin/jobs/${JOB_ID}`, job));
    }),
    http.get(PLAN, () => {
      seen.planCalls += 1;
      if (plan === "missing") {
        return HttpResponse.json(planNotFoundBody(), { status: 404 });
      }
      return HttpResponse.json(envelope(`/admin/jobs/${JOB_ID}/transport-plan`, plan));
    }),
  );
  return seen;
}

const renderList = async (params: Record<string, string> = {}) =>
  (await renderServerComponent(<JobsPage searchParams={Promise.resolve(params)} />)).replaceAll(
    "<!-- -->",
    "",
  );

const renderDetail = async (id: string = JOB_ID) =>
  (await renderServerComponent(<JobDetailPage params={Promise.resolve({ id })} />)).replaceAll(
    "<!-- -->",
    "",
  );

describe("who can see the job list", () => {
  it("refuses a user.read holder and never asks GET /admin/jobs", async () => {
    stubMe(["user.read"]);
    const list = watchList();

    const html = await renderList();

    expect(list.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("İlanları görüntüle");
    expect(html).not.toContain("Garsonluk");
  });

  it("lists jobs for job.read with the employer, counts and a link to the detail", async () => {
    stubMe(AGENT);
    const list = watchList();

    const html = await renderList();

    expect(list.calls).toBe(1);
    expect(list.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(list.url?.searchParams.get("status")).toBeNull();
    expect(list.url?.searchParams.get("sort")).toBe("createdAt,desc");
    expect(html).not.toContain("ACCESS-TOKEN");

    expect(html).toContain("Garsonluk");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("Koala Kafe");
    expect(html).toContain("Kadıköy / İstanbul");
    expect(html).toContain("20.09.2026 09:00");
    // Satır bağlantısı liste görünümünü taşır; ilan sayfasının kırıntısı geri okur (#112).
    expect(html).toContain(
      `href="/jobs/${JOB_ID}?durum=ALL&amp;sirala=createdAt%2Cdesc&amp;boyut=20&amp;sayfa=0"`,
    );
    expect(html).toContain("Açık");
  });
});

/** koala-admin#112: kırıntı menüdeki adla, süzgeç geri taşınır. */
const COMPANY_ID = "c1000000-0000-4000-8000-000000000001";

describe("the job page's breadcrumb", () => {
  it("writes İlanlar › short id and links the list with the carried view", async () => {
    stubMe(AGENT);
    watchDetail();

    const html = (
      await renderServerComponent(
        <JobDetailPage
          params={Promise.resolve({ id: JOB_ID })}
          searchParams={Promise.resolve({ durum: "OPEN", sirket: COMPANY_ID, sayfa: "3" })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).toContain('<nav aria-label="Konum">');
    expect(html).toContain(`href="/jobs?durum=OPEN&amp;sayfa=3&amp;sirket=${COMPANY_ID}"`);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/jobs\\?[^"]*"><span[^>]*>İlanlar</span></a>`));
    expect(html).toMatch(
      new RegExp(`aria-current="page"[^>]*><span[^>]*title="${JOB_ID}">${JOB_ID.slice(0, 8)}<`),
    );
  });

  it("links the bare list when the object URL carries no view", async () => {
    stubMe(AGENT);
    watchDetail();

    const html = await renderDetail();

    expect(html).toContain('href="/jobs"><span');
  });
});

describe("status filter and search are backend query parameters", () => {
  it("sends durum as status", async () => {
    stubMe(AGENT);
    const list = watchList();

    await renderList({ durum: "CLOSED" });

    expect(list.url?.searchParams.get("status")).toBe("CLOSED");
  });

  it("drops an unknown status and a sort Spring would reject", async () => {
    stubMe(AGENT);
    const list = watchList();

    await renderList({ durum: "banana", sirala: "email,asc" });

    expect(list.url?.searchParams.get("status")).toBeNull();
    expect(list.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("sends ara to the backend as query and names it in the result line", async () => {
    stubMe(AGENT);
    const list = watchList();

    const html = await renderList({ ara: " garson " });

    expect(list.url?.searchParams.get("query")).toBe("garson");
    expect(html).toContain("“garson” için 1 ilan bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("says there is no result for the query", async () => {
    stubMe(AGENT);
    watchList([]);

    const html = await renderList({ ara: "kimse" });

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html).not.toContain("İlan yok.");
  });

  it("names the empty status filter", async () => {
    stubMe(AGENT);
    watchList([]);

    const html = await renderList({ durum: "CANCELLED" });

    expect(html).toContain("İptal durumunda ilan yok.");
  });

  it("shows the backend's 400 for an over-long query inline", async () => {
    stubMe(AGENT);
    server.use(
      http.get(JOBS, () =>
        HttpResponse.json(searchQueryTooLongBody("/admin/jobs"), { status: 400 }),
      ),
    );

    const html = await renderList({ ara: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("İlan listesi yüklenemedi.");
  });

  it("renders a load failure with the request id", async () => {
    stubMe(AGENT);
    server.use(
      http.get(JOBS, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmeyen hata.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/jobs",
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );

    const html = await renderList();

    expect(html).toContain("İlan listesi yüklenemedi.");
    expect(html).toContain("rid-500");
  });
});

describe("the job object page", () => {
  it("refuses without job.read and never asks the backend", async () => {
    stubMe(["user.read"]);
    const seen = watchDetail();

    const html = await renderDetail();

    expect(seen.calls).toBe(0);
    expect(seen.planCalls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain("Caferağa");
  });

  it("renders the full address, images and counts", async () => {
    stubMe(AGENT);
    const seen = watchDetail();

    const html = await renderDetail();

    expect(seen.calls).toBe(1);
    expect(seen.planCalls).toBe(1);
    expect(html).toContain("Ulaşım planı yok");
    expect(html).toContain(
      "Caferağa Mah., Moda Cad., No 12, Kat 2, Daire 5, 34710, Kadıköy, İstanbul, Türkiye",
    );
    expect(html).toContain("Eczanenin üstü");
    expect(html).toContain("https://storage.koala.test/jobs/1.jpg");
    expect(html).toContain("Kapak");
    expect(html).toContain("Hafta sonu kahvaltı servisi.");
    expect(html).toContain("mehmet@example.com");
    expect(html).toContain("1234567890");
    expect(html).toContain("20.09.2026 09:00");
    expect(html).toContain("20.09.2026 17:00");
    expect(html).toContain("₺155,00");
    expect(html).toContain("₺1.378,33");
    // Başvuru 12, atama 2, kişi 3 — sayılar tablodan değil DTO'dan.
    expect(html).toMatch(/Başvuru<\/dt><dd[^>]*>12</);
    expect(html).toMatch(/Atama<\/dt><dd[^>]*>2</);
  });

  it("shows shuttle plates and driver when the staff plan endpoint returns them", async () => {
    stubMe(AGENT);
    const seen = watchDetail(adminJobDetailFixture(), {
      id: "tp000000-0000-4000-8000-000000000001",
      jobId: JOB_ID,
      outboundMethod: "SHUTTLE",
      returnMethod: "CASH_ALLOWANCE",
      allowanceAmount: 150,
      allowanceNote: "İş çıkışı elden",
      notes: "Servis kapıda bekler",
      shuttles: [
        {
          id: "sh000000-0000-4000-8000-000000000001",
          direction: "OUTBOUND",
          name: "Anadolu servisi",
          plate: "34 ABC 12",
          capacity: 12,
          seatsTaken: 3,
          driverName: "Ahmet Şoför",
          driverPhone: "+905551112233",
          sortOrder: 0,
          stops: [
            {
              id: "st000000-0000-4000-8000-000000000001",
              label: "Kadıköy İskele",
              scheduledAt: "2026-09-20T03:40:00.000Z",
              sortOrder: 0,
              address: {
                displayAddress: "Barbaros Bulvarı 45, Beşiktaş",
                districtName: "Beşiktaş",
                cityName: "İstanbul",
                countryName: "Türkiye",
              },
              seatsTaken: 3,
            },
          ],
        },
      ],
      updatedAt: "2026-09-15T10:00:00Z",
    });

    const html = await renderDetail();

    expect(seen.planCalls).toBe(1);
    expect(html).toContain("Anadolu servisi");
    expect(html).toContain("34 ABC 12");
    expect(html).toContain("Ahmet Şoför");
    expect(html).toContain("+905551112233");
    expect(html).toContain("Kadıköy İskele");
    expect(html).toContain("Barbaros Bulvarı 45, Beşiktaş");
    expect(html).toContain("Yol parası");
    expect(html).not.toContain("Ulaşım planı yok");
  });

  it("prefers the backend's displayAddress when it exists", async () => {
    stubMe(AGENT);
    const job = adminJobDetailFixture();
    watchDetail({
      ...job,
      address: { ...(job.address as object), displayAddress: "Moda Cad. No 12, Kadıköy" },
    });

    const html = await renderDetail();

    expect(html).toContain("Moda Cad. No 12, Kadıköy");
    expect(html).not.toContain("Caferağa Mah., Moda Cad.");
  });

  it("links the company only to a company.approve holder", async () => {
    stubMe(AGENT);
    watchDetail();
    expect(await renderDetail()).not.toContain('href="/companies/');

    stubMe(["job.read", "company.approve"]);
    watchDetail();
    expect(await renderDetail()).toContain(
      'href="/companies/c1000000-0000-4000-8000-000000000001"',
    );
  });

  it("says when there is no address and no image", async () => {
    stubMe(AGENT);
    watchDetail(adminJobDetailFixture({ address: null, images: [], pricing: null }));

    const html = await renderDetail();

    expect(html).toContain("Bu ilanda adres kaydı yok.");
    expect(html).toContain("Bu ilana görsel eklenmemiş.");
    expect(html).toContain("Bu ilan için fiyat dökümü yok.");
  });
});

/** koala-admin#85: olmayan ilan ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("a job that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(AGENT);
    let calls = 0;
    server.use(
      http.get(JOB, () => {
        calls += 1;
        return HttpResponse.json(
          { ...resourceNotFoundBody, errorCode: "JOB_NOT_FOUND", path: `/admin/jobs/${JOB_ID}` },
          { status: 404 },
        );
      }),
    );

    const thrown = await renderServerComponent(
      <JobDetailPage params={Promise.resolve({ id: JOB_ID })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(AGENT);
    const seen = watchDetail();

    const thrown = await renderServerComponent(
      <JobDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(seen.calls).toBe(0);
    expect(seen.planCalls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

/** koala-admin#99: `JobCompanyDto.website/type` ve denetim izi bağlantısı. */
describe("the company's type and website, and the audit pointer", () => {
  it("names the company type and links the website in a new tab", async () => {
    stubMe(AGENT);
    const job = adminJobDetailFixture();
    watchDetail({
      ...job,
      company: { ...(job.company as object), website: "https://koalakafe.test", type: "LIMITED" },
    });

    const html = await renderDetail();

    expect(html).toMatch(/Şirket türü<\/dt><dd[^>]*>Limited şirket</);
    expect(html).toMatch(
      /<a href="https:\/\/koalakafe\.test" target="_blank" rel="noopener noreferrer"/,
    );
  });

  it("writes the empty value for a missing website and keeps a non-http address as text", async () => {
    stubMe(AGENT);
    watchDetail();
    expect(await renderDetail()).toMatch(/Web sitesi<\/dt><dd[^>]*>—</);

    const job = adminJobDetailFixture();
    watchDetail({
      ...job,
      company: { ...(job.company as object), website: "javascript:alert(1)", type: null },
    });
    const html = await renderDetail();
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain("javascript:alert(1)");
    expect(html).toMatch(/Şirket türü<\/dt><dd[^>]*>—</);
  });

  it("points at the audit log filtered to this job, only for an audit.read holder", async () => {
    stubMe(AGENT);
    watchDetail();
    const alone = await renderDetail();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...AGENT, "audit.read"]);
    watchDetail();
    const html = await renderDetail();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${JOB_ID}"`);
  });
});

/** koala-admin#100: `?sirket=` backend'in `companyId` süzgecine gider (koala-backend#283). */
describe("the company filter — koala-admin#100", () => {
  const COMPANY = "c1000000-0000-4000-8000-000000000001";

  it("sends sirket as companyId next to status and offers to drop the filter", async () => {
    stubMe(AGENT);
    const list = watchList();

    const html = await renderList({ sirket: COMPANY, durum: "OPEN" });

    expect(list.url?.searchParams.get("companyId")).toBe(COMPANY);
    expect(list.url?.searchParams.get("status")).toBe("OPEN");
    expect(html).toContain('data-testid="job-company-filter"');
    expect(html).toContain(COMPANY);
    expect(html).toContain('href="/jobs?durum=OPEN&amp;sirala=createdAt%2Cdesc&amp;boyut=20"');
  });

  it("drops a company id that is not a UUID before it reaches the backend", async () => {
    stubMe(AGENT);
    const list = watchList();

    const html = await renderList({ sirket: "not-a-uuid" });

    expect(list.url?.searchParams.has("companyId")).toBe(false);
    expect(html).not.toContain('data-testid="job-company-filter"');
  });
});

describe("staff notes and flags on jobs", () => {
  const FLAGS = apiUrl("/admin/flags");
  const NOTES = apiUrl("/admin/notes");

  it("does not ask GET /admin/flags without note.read", async () => {
    stubMe(AGENT);
    watchList();
    const flags = { calls: 0 };
    server.use(
      http.get(FLAGS, () => {
        flags.calls += 1;
        return HttpResponse.json(envelope("/admin/flags", []));
      }),
    );

    await renderList();
    expect(flags.calls).toBe(0);
  });

  it("paints a VIP badge on the list when note.read holds", async () => {
    stubMe(["job.read", "note.read"]);
    watchList();
    server.use(
      http.get(FLAGS, () =>
        HttpResponse.json(
          envelope("/admin/flags", [
            {
              id: "f-1",
              resourceType: "JOB",
              resourceId: JOB_ID,
              kind: "VIP",
              label: null,
              setByStaffId: "s-1",
              setByDisplayName: "Trust",
              setAt: "2026-09-15T11:00:00Z",
              clearedAt: null,
            },
          ]),
        ),
      ),
    );

    const html = await renderList();
    expect(html).toContain("VIP");
    expect(html).toContain('data-testid="staff-flag-badges"');
  });

  it("shows the notes section on the object page for note.read", async () => {
    stubMe(["job.read", "note.read"]);
    watchDetail();
    server.use(
      http.get(NOTES, () =>
        HttpResponse.json(
          pageEnvelope("/admin/notes", [
            {
              id: "11111111-1111-4111-8111-111111111111",
              resourceType: "JOB",
              resourceId: JOB_ID,
              authorStaffId: "s-1",
              authorDisplayName: "Destek",
              body: "İşverenle konuştuk.",
              createdAt: "2026-09-15T10:00:00Z",
              editedAt: null,
            },
          ]),
        ),
      ),
      http.get(FLAGS, () => HttpResponse.json(envelope("/admin/flags", []))),
    );

    const html = await renderDetail();
    expect(html).toContain("İşverenle konuştuk.");
    expect(html).toContain('data-testid="staff-notes"');
  });
});
