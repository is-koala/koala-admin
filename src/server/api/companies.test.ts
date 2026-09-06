import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { readPaging } from "./paging";
import {
  COMPANY_PAGING,
  approveCompany,
  companyContactRoleLabel,
  companyTypeLabel,
  contactDisplayName,
  getCompanies,
} from "./companies";

/**
 * Same claim as the report queue, on a different endpoint: the filter and the
 * page are query parameters, and the approval call carries no body it is not
 * entitled to.
 */

const COMPANIES = apiUrl("/admin/companies");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const COMPANY = {
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
  images: [{ id: "i1", url: "https://cdn.test/1.jpg", caption: null }],
  approved: false,
};

function watchQueue(content: unknown[] = [COMPANY]) {
  const seen: { url: URL | null; authorization: string | null } = {
    url: null,
    authorization: null,
  };

  server.use(
    http.get(COMPANIES, ({ request }) => {
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "Şirketler listelendi.",
        httpStatus: "200 OK",
        path: "/admin/companies",
        requestId: "rid-companies",
        timeStamp: "2026-09-06T09:40:00.000000000Z",
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
  it("defaults to the companies waiting for a decision", async () => {
    // `@RequestParam(defaultValue = "false") boolean approved` — the panel sends
    // it explicitly rather than relying on the default, so the URL says what the
    // screen shows.
    const seen = watchQueue();

    await getCompanies("ACCESS-TOKEN", {
      approved: false,
      paging: readPaging({}, COMPANY_PAGING),
    });

    expect(seen.url?.searchParams.get("approved")).toBe("false");
    expect(seen.url?.searchParams.get("page")).toBe("0");
    expect(seen.url?.searchParams.get("size")).toBe("20");
    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
  });

  it("sends the approved filter, the page and the sort the URL asked for", async () => {
    const seen = watchQueue();

    await getCompanies("ACCESS-TOKEN", {
      approved: true,
      paging: readPaging({ sayfa: "1", boyut: "40", sirala: "name,asc" }, COMPANY_PAGING),
    });

    expect(seen.url?.searchParams.get("approved")).toBe("true");
    expect(seen.url?.searchParams.get("page")).toBe("1");
    expect(seen.url?.searchParams.get("size")).toBe("40");
    expect(seen.url?.searchParams.get("sort")).toBe("name,asc");
  });

  it("never sends a sort field CompanyManager would reject", async () => {
    // COMPANY_SORTABLE is {createdAt, name}; anything else is a 400.
    const seen = watchQueue();

    await getCompanies("ACCESS-TOKEN", {
      approved: false,
      paging: readPaging({ sirala: "taxNumber,asc" }, COMPANY_PAGING),
    });

    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("reads the registration details, the contacts and the gallery", async () => {
    watchQueue();

    const page = await getCompanies("ACCESS-TOKEN", {
      approved: false,
      paging: readPaging({}, COMPANY_PAGING),
    });

    const company = page.content[0];
    expect(company?.name).toBe("Koala Kahve A.Ş.");
    expect(company?.taxNumber).toBe("1234567890");
    expect(company?.address?.displayAddress).toBe("Kadıköy, İstanbul");
    expect(company?.companyContacts).toHaveLength(1);
    expect(company?.images).toHaveLength(1);
    expect(company?.approved).toBe(false);
  });

  it("survives a company with no address, contacts or gallery", async () => {
    // All three are nullable in the DTO; a half-filled application is exactly
    // the kind that ends up in an approval queue.
    watchQueue([
      {
        id: "9c000000-0000-4000-8000-000000000002",
        name: "Yeni Şirket",
        approved: false,
      },
    ]);

    const page = await getCompanies("ACCESS-TOKEN", {
      approved: false,
      paging: readPaging({}, COMPANY_PAGING),
    });

    expect(page.content[0]?.address).toBeNull();
    expect(page.content[0]?.companyContacts).toEqual([]);
    expect(page.content[0]?.images).toEqual([]);
  });
});

describe("approving a company", () => {
  it("posts to the approve endpoint with no body at all", async () => {
    // The controller takes only `@PathVariable UUID companyId`. Sending JSON it
    // never reads would suggest the approval note is stored; it is not.
    let contentType: string | null = null;
    let raw: string | null = null;
    let url: string | null = null;

    server.use(
      http.post(`${COMPANIES}/:companyId/approve`, async ({ request }) => {
        url = request.url;
        contentType = request.headers.get("content-type");
        raw = await request.text();
        return HttpResponse.json({
          success: true,
          message: "Şirket onaylandı.",
          httpStatus: "200 OK",
          path: "/admin/companies/9c000000-0000-4000-8000-000000000001/approve",
          requestId: "rid-approve",
          timeStamp: "2026-09-06T09:41:00.000000000Z",
          data: { ...COMPANY, approved: true },
        });
      }),
    );

    const approved = await approveCompany("ACCESS-TOKEN", COMPANY.id);

    expect(url).toBe(`${COMPANIES}/${COMPANY.id}/approve`);
    expect(raw).toBe("");
    expect(contentType).toBeNull();
    expect(approved.approved).toBe(true);
  });

  it("escapes the company id rather than pasting it into a path", async () => {
    let url: string | null = null;
    server.use(
      http.post(`${COMPANIES}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await approveCompany("ACCESS-TOKEN", "../../me").catch(() => undefined);

    expect(url).toContain("%2F");
  });
});

describe("labels", () => {
  it("translates the company types the backend declares", () => {
    expect(companyTypeLabel("CORPORATION")).toBe("Anonim şirket");
    expect(companyTypeLabel("SOLE_PROPRIETORSHIP")).toBe("Şahıs şirketi");
  });

  it("shows an unknown type as its code rather than as a blank cell", () => {
    expect(companyTypeLabel("COOPERATIVE")).toBe("COOPERATIVE");
    expect(companyTypeLabel(null)).toBeNull();
  });

  it("names a contact by their name, falling back to the username", () => {
    expect(
      contactDisplayName({
        id: "c1",
        user: {
          id: "u1",
          firstName: "Ayşe",
          lastName: "Yılmaz",
          username: "ayse",
          profilePictureUrl: null,
        },
        role: "ADMIN",
      }),
    ).toBe("Ayşe Yılmaz");

    expect(
      contactDisplayName({
        id: "c2",
        user: {
          id: "u2",
          firstName: null,
          lastName: null,
          username: "mehmet",
          profilePictureUrl: null,
        },
        role: "STAFF",
      }),
    ).toBe("mehmet");

    expect(contactDisplayName({ id: "c3", user: null, role: "STAFF" })).toBeNull();
  });

  it("says which contacts are authorised for the company", () => {
    expect(companyContactRoleLabel("ADMIN")).toBe("Şirket yetkilisi");
    expect(companyContactRoleLabel("STAFF")).toBe("Şirket çalışanı");
  });
});
