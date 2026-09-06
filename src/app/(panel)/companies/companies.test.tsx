import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * koala-admin#8's acceptance criteria, rendered.
 *
 * The screen's job is to end a dead end — nobody could move a company out of
 * `PENDING`, so no company could post a job — while being straight about the
 * three things `AdminController` does not do: reject, record a reason, or tell
 * the company owner anything.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { default: CompaniesPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const COMPANIES = apiUrl("/admin/companies");

const APPROVER = ["company.approve"];
/** Holds a moderation permission and no approval right. */
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

function company(overrides: Record<string, unknown> = {}) {
  return {
    id: "9c000000-0000-4000-8000-000000000001",
    name: "Koala Kahve A.Ş.",
    email: "info@koalakahve.test",
    logoUrl: null,
    phoneNumber: "+905551112233",
    website: "https://koalakahve.test",
    description: "Üçüncü nesil kahveci.",
    taxNumber: "1234567890",
    type: "CORPORATION",
    address: {
      displayAddress: "Kadıköy, İstanbul",
      cityName: "İstanbul",
      districtName: "Kadıköy",
      countryName: "Türkiye",
    },
    companyContacts: [
      {
        id: "c1",
        user: {
          id: "u1",
          firstName: "Ayşe",
          lastName: "Yılmaz",
          username: "ayse",
          profilePictureUrl: null,
        },
        role: "ADMIN",
      },
    ],
    images: [],
    approved: false,
    ...overrides,
  };
}

function watchQueue(rows: unknown[] = [], respond?: () => Response) {
  const seen: { calls: number; url: URL | null } = { calls: 0, url: null };

  server.use(
    http.get(COMPANIES, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);

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

/** React inserts `<!-- -->` between adjacent interpolations; drop them. */
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
    expect(html).toContain("Şirket onay kuyruğu");
    expect(html).not.toContain("Koala Kahve");
  });

  it("lets company.approve through and makes the request", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([company()]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(html).toContain("Koala Kahve A.Ş.");
  });
});

describe("the filter and the page are query parameters", () => {
  it("defaults to the companies waiting for a decision", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([company()]);

    await render();

    expect(queue.url?.searchParams.get("approved")).toBe("false");
    expect(queue.url?.searchParams.get("page")).toBe("0");
    expect(queue.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("switches to the approved view when the URL says so", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([company({ approved: true })]);

    await render({ onay: "onayli", sayfa: "1", sirala: "name,asc" });

    expect(queue.url?.searchParams.get("approved")).toBe("true");
    expect(queue.url?.searchParams.get("page")).toBe("1");
    expect(queue.url?.searchParams.get("sort")).toBe("name,asc");
  });

  it("falls back to the pending view for a nonsense parameter", async () => {
    stubMe(APPROVER);
    const queue = watchQueue([]);

    await render({ onay: "belki" });

    expect(queue.url?.searchParams.get("approved")).toBe("false");
  });

  it("says there is no search, rather than offering one that only searches a page", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Ada ya da vergi numarasına göre arama yok");
  });
});

describe("what the queue and the detail show", () => {
  it("puts the registration details in the table and the detail", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Koala Kahve A.Ş.");
    expect(html).toContain("Anonim şirket");
    expect(html).toContain("1234567890");
    expect(html).toContain("Kadıköy, İstanbul");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Şirket yetkilisi");
  });

  it("says the application date and creator are not returned", async () => {
    // koala-admin#8 asks for "oluşturan, tarih"; CompanyDto carries neither.
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Başvuru tarihi ve başvuran");
    expect(html).toContain("Backend döndürmüyor.");
    expect(html).toContain("başvuruyu açan kişi ile aynı olmak zorunda değildir");
  });

  it("does not call gallery images documents without saying what they are", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Backend&#x27;de belge için ayrı bir alan da yok");
  });

  it("distinguishes an empty queue from a failure", async () => {
    stubMe(APPROVER);
    watchQueue([]);

    const html = await render();

    expect(html).toContain("Onay bekleyen şirket yok. Kuyruk temiz.");
    expect(html).not.toContain("Şirket kuyruğu yüklenemedi.");
  });

  it("renders the backend's 403 rather than crashing when the gate opened anyway", async () => {
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

describe("the decision, and the three things it does not do", () => {
  it("states the missing rejection path above the queue, not buried in a form", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Bu kuyrukta ret yolu yok.");
    expect(html).toContain("Panel bunun için bir düğme uydurmuyor");
  });

  it("offers approval only, and marks it irreversible", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Şirketi onayla");
    expect(html).toContain("Geri alınamaz");
    expect(html).toContain("ilan yayınlayabilir hale gelir");
    // One radio, one value. Asserting on the word "reddet" would not work:
    // the page says the rejection endpoint is missing, repeatedly and on
    // purpose. What must not exist is a control.
    expect([...html.matchAll(/name="decision"/g)]).toHaveLength(1);
    expect(html).toContain('value="APPROVE"');
    expect(html).not.toContain('value="REJECT"');
  });

  it("requires a written reason and says where it does not go", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Onay gerekçesi");
    expect(html).toContain("Gerekçeniz backend&#x27;e gitmez.");
  });

  it("warns that the owner is not notified, because the backend never notifies", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Şirket sahibine bildirim gitmez.");
    expect(html).toContain("bildirim servisi çağrılmıyor");
  });

  it("closes the form on a company the backend would answer 409 for", async () => {
    stubMe(APPROVER);
    watchQueue([company({ approved: true })]);

    const html = await render({ onay: "onayli" });

    expect(html).toContain("Bu şirket zaten onaylı.");
    // No form at all — not a form with a disabled button.
    expect(html).not.toContain('name="note"');
    expect(html).not.toContain("Gerekçe yazılmadan karar gönderilemez.");
  });
});

describe("the gaps are on the screen", () => {
  it("lists what AdminController cannot answer, including the rejection endpoint", async () => {
    stubMe(APPROVER);
    watchQueue([company()]);

    const html = await render();

    expect(html).toContain("Backend&#x27;in veremedikleri");
    expect(html).toContain("Ret yolu yok");
    expect(html).toContain("Onay sonrası şirkete bildirim gitmiyor");
  });

  it("still lists them when the queue itself could not be loaded", async () => {
    stubMe(APPROVER);
    watchQueue([], () => HttpResponse.error());

    const html = await render();

    expect(html).toContain("Şirket kuyruğu yüklenemedi.");
    expect(html).toContain("Backend&#x27;in veremedikleri");
  });
});
