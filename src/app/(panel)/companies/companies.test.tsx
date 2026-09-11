import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reviewCompany, type CompanyReviewOverrides } from "../../../../test/fixtures/companies";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: CompaniesPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const COMPANIES = apiUrl("/admin/companies");

const APPROVER = ["company.approve"];
const MODERATOR = ["content.moderate"];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["COMPANY_REVIEWER"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function company(overrides: CompanyReviewOverrides = {}) {
  const review = reviewCompany(overrides);

  return {
    ...review,
    createdBy:
      review.createdBy === null
        ? null
        : {
            ...review.createdBy,
            email: "private@koala.test",
            passwordHash: "never-render-this",
          },
    address: { displayAddress: "must not render" },
    companyContacts: [{ id: "must-not-render" }],
  };
}

function watchQueue(rows: unknown[] = [], respond?: () => Response) {
  const seen: { calls: number; url: URL | null; authorization: string | null } = {
    calls: 0,
    url: null,
    authorization: null,
  };

  server.use(
    http.get(COMPANIES, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");

      if (respond !== undefined) return respond();

      return HttpResponse.json({
        success: true,
        message: "Şirketler listelendi.",
        httpStatus: "200 OK",
        path: "/admin/companies",
        requestId: "rid-companies",
        timeStamp: "2026-09-06T09:40:00.000000000Z",
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

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(<CompaniesPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

describe("who can see the queue", () => {
  it("refuses a MODERATOR and never asks the backend for companies", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const queue = watchQueue([company()]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Şirket başvurularını onayla");
    expect(html).not.toContain("Koala Kahve");
  });

  it("lets company.approve through and keeps the bearer token on the server", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([company()]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(queue.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).toContain("Koala Kahve A.Ş.");
    expect(html).not.toContain("ACCESS-TOKEN");
  });
});

describe("status, search and paging are backend query parameters", () => {
  it("defaults to PENDING and never sends the retired approved filter", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([]);

    await render();

    expect(queue.url?.searchParams.get("status")).toBe("PENDING");
    expect(queue.url?.searchParams.has("approved")).toBe(false);
    expect(queue.url?.searchParams.get("page")).toBe("0");
    expect(queue.url?.searchParams.get("size")).toBe("20");
    expect(queue.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("sends each non-default status with the requested page and sort", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([]);

    await render({ durum: "APPROVED", sayfa: "1", boyut: "40", sirala: "name,asc" });

    expect(queue.url?.searchParams.get("status")).toBe("APPROVED");
    expect(queue.url?.searchParams.get("page")).toBe("1");
    expect(queue.url?.searchParams.get("size")).toBe("40");
    expect(queue.url?.searchParams.get("sort")).toBe("name,asc");
  });

  it("sends REJECTED and a trimmed name or tax-number search", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([]);

    const html = await render({ durum: "REJECTED", ara: "  1234567890  " });

    expect(queue.url?.searchParams.get("status")).toBe("REJECTED");
    expect(queue.url?.searchParams.get("query")).toBe("1234567890");
    expect(html).toContain("Şirket adı ya da vergi numarası ara");
    expect(html).toContain('type="search"');
  });

  it("falls back to PENDING for a status Spring would reject", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([]);

    await render({ durum: "MAYBE" });

    expect(queue.url?.searchParams.get("status")).toBe("PENDING");
  });

  it("keeps a previous-page control when the requested nonzero page becomes empty", async () => {
    stubMe(APPROVER);
    watchQueue([], () =>
      HttpResponse.json({
        success: true,
        message: "Şirketler listelendi.",
        data: {
          content: [],
          page: 1,
          size: 20,
          totalElements: 20,
          totalPages: 1,
          first: false,
          last: true,
        },
      }),
    );

    const html = await render({ sayfa: "1" });
    const container = document.createElement("div");
    container.innerHTML = html;
    const previous = [
      ...container.querySelectorAll<HTMLButtonElement>('button[name="sayfa"]'),
    ].find((button) => button.textContent === "Önceki");

    expect(previous).toBeDefined();
    expect(previous?.value).toBe("0");
    expect(previous?.disabled).toBe(false);
  });
});

describe("the safe review projection", () => {
  it("renders creator, timestamps, status and saved note without extra user or company fields", async () => {
    stubMe(APPROVER);
    watchQueue([
      company({
        approvalStatus: "REJECTED",
        approvalNote: "Vergi levhası okunmuyor.",
        approvalDecidedAt: "2026-09-06T09:40:00Z",
      }),
    ]);

    const html = await render({ durum: "REJECTED" });

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("01.09.2026 11:00");
    expect(html).toContain("06.09.2026 12:40");
    expect(html).toContain("Reddedildi");
    expect(html).toContain("Vergi levhası okunmuyor.");
    expect(html).not.toContain("private@koala.test");
    expect(html).not.toContain("never-render-this");
    expect(html).not.toContain("must not render");
    expect(html).not.toContain("must-not-render");
  });

  it("renders explicit fallbacks when optional review metadata is absent", async () => {
    stubMe(APPROVER);
    watchQueue([
      company({
        name: "Yeni Şirket",
        email: null,
        phoneNumber: null,
        taxNumber: null,
        type: null,
        createdAt: null,
        createdBy: null,
      }),
    ]);

    const html = await render();

    expect(html).toContain("Yeni Şirket");
    expect(html).toContain("Oluşturan");
    expect(html).toContain("Başvuru zamanı");
    expect(html).toContain("—");
  });

  it("distinguishes an empty search result from a load failure", async () => {
    stubMe(APPROVER);
    watchQueue([]);

    const html = await render({ ara: "kahve" });

    expect(html).toContain("Aramayla eşleşen şirket yok.");
    expect(html).not.toContain("Şirket kuyruğu yüklenemedi.");
  });

  it("renders the backend's 403 rather than an empty queue", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([], () =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: "/admin/companies",
          timeStamp: "2026-09-06T09:41:00.000000000Z",
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

describe("the backend decision state machine", () => {
  it("keeps successful decision feedback visible after the decided row leaves the queue", async () => {
    stubMe(APPROVER);
    watchQueue([]);

    const html = await render({ durum: "PENDING", sonuc: "approved" });

    expect(html).toContain("Onay kararı backend tarafından kaydedildi.");
    expect(html).toContain('role="status"');
  });

  it("keeps successful decision feedback visible when the refreshed queue fails to load", async () => {
    stubMe(APPROVER);
    watchQueue([], () => HttpResponse.error());

    const html = await render({ sonuc: "rejected" });

    expect(html).toContain("Ret kararı backend tarafından kaydedildi.");
    expect(html).toContain("Şirket kuyruğu yüklenemedi.");
  });

  it("carries the canonical queue location into the decision action", async () => {
    stubMe(APPROVER);
    watchQueue([company({ approvalStatus: "REJECTED" })]);

    const html = await render({
      durum: "REJECTED",
      ara: "  Koala  ",
      sirala: "name,asc",
      boyut: "40",
      sayfa: "2",
    });
    const container = document.createElement("div");
    container.innerHTML = html;

    expect(container.querySelector<HTMLInputElement>('input[name="returnTo"]')?.value).toBe(
      "/companies?durum=REJECTED&ara=Koala&sirala=name%2Casc&boyut=40&sayfa=2",
    );
  });

  it("offers both approval and rejection for PENDING", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect([...html.matchAll(/name="decision"/g)]).toHaveLength(2);
    expect(html).toContain('value="APPROVE"');
    expect(html).toContain('value="REJECT"');
    expect(html).toContain("Karar gerekçesi");
    expect(html).toContain('maxLength="1000"');
  });

  it("lets a REJECTED company be approved but not rejected twice", async () => {
    stubMe(APPROVER);
    watchQueue([company({ approvalStatus: "REJECTED", approvalNote: "Eksik evrak." })]);

    const html = await render({ durum: "REJECTED" });

    expect([...html.matchAll(/name="decision"/g)]).toHaveLength(1);
    expect(html).toContain('value="APPROVE"');
    expect(html).not.toContain('value="REJECT"');
    expect(html).toContain("önceki ret gerekçesinin yerini");
  });

  it("closes every decision control for APPROVED", async () => {
    stubMe(APPROVER);
    watchQueue([company({ approvalStatus: "APPROVED" })]);

    const html = await render({ durum: "APPROVED" });

    expect(html).toContain("Backend onayı geri almaya");
    expect(html).not.toContain('name="decision"');
    expect(html).not.toContain('name="note"');
  });

  it("states that notes persist and notification delivery is not claimed", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Gerekçe şirket kararında saklanır.");
    expect(html).toContain("varsa şirketin ADMIN yetkilileri");
    expect(html).toContain("göndermeyi dener");
    expect(html).toContain("teslim veya denetim kaydı sonucunu taşımadığı");
    expect(html).not.toContain("yönetim denetim kaydında saklanır");
    expect(html).not.toContain("bildirim gitmez");
  });
});

describe("unfinished-work copy stays off the screen", () => {
  it("does not tell operators which DTO fields are missing", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).not.toContain("İnceleme verisinin sınırı");
    expect(html).not.toContain("sözleşmede yoktur");
  });

  it("still loads a useful error without a contract lecture", async () => {
    stubMe(APPROVER);
    watchQueue([], () => HttpResponse.error());

    const html = await render();

    expect(html).toContain("Şirket kuyruğu yüklenemedi.");
    expect(html).not.toContain("İnceleme verisinin sınırı");
  });
});
