import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { COMPANY_REVIEW_ID, reviewCompany } from "../../../test/fixtures/companies";
import { apiUrl, server } from "../../../test/msw";

import { readPaging } from "./paging";
import {
  COMPANY_PAGING,
  approveCompany,
  companyApprovalStatusLabel,
  companyImageDownloadPath,
  companyTypeLabel,
  getCompanies,
  getCompany,
  rejectCompany,
  safeUserDisplayName,
} from "./companies";

/**
 * Same claim as the report queue, on a different endpoint: filters and paging
 * are query parameters, while each decision sends exactly the note field its
 * backend request DTO accepts.
 */

const COMPANIES = apiUrl("/admin/companies");

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const COMPANY_ID = COMPANY_REVIEW_ID;
const SAFE_CONTACT = {
  id: "cc000000-0000-4000-8000-000000000001",
  user: { id: "u2", firstName: "Ali", lastName: "Kaya", username: "ali", profilePictureUrl: null },
  role: "ADMIN",
};
const SAFE_REVIEW_COMPANY = reviewCompany({ companyContacts: [SAFE_CONTACT] });
const REVIEW_COMPANY = {
  ...SAFE_REVIEW_COMPANY,
  createdBy: {
    ...SAFE_REVIEW_COMPANY.createdBy,
    email: "private@koala.test",
    passwordHash: "never-render-this",
  },
  // koala-backend#283: yetkililer artık okunur, ama kullanıcı yine SafeUserDto — e-posta düşer.
  companyContacts: [
    { ...SAFE_CONTACT, user: { ...SAFE_CONTACT.user, email: "contact@koala.test" } },
  ],
  images: [{ id: "must-be-stripped", storageKey: "s3://secret", fileUrl: "https://store.test/x" }],
  address: {
    ...SAFE_REVIEW_COMPANY.address,
    fileUrl: "https://store.test/must-not-parse",
    storageKey: "companies/secret",
  },
};

function watchQueue(content: unknown[] = [REVIEW_COMPANY]) {
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
    const seen = watchQueue();

    await getCompanies("ACCESS-TOKEN", {
      status: "PENDING",
      query: null,
      paging: readPaging({}, COMPANY_PAGING),
    });

    expect(seen.url?.searchParams.get("status")).toBe("PENDING");
    expect(seen.url?.searchParams.has("approved")).toBe(false);
    expect(seen.url?.searchParams.has("query")).toBe(false);
    expect(seen.url?.searchParams.get("page")).toBe("0");
    expect(seen.url?.searchParams.get("size")).toBe("20");
    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
  });

  it("sends the status, search, page and sort the screen asked for", async () => {
    const seen = watchQueue();

    await getCompanies("ACCESS-TOKEN", {
      status: "APPROVED",
      query: "  kahve  ",
      paging: readPaging({ sayfa: "1", boyut: "40", sirala: "name,asc" }, COMPANY_PAGING),
    });

    expect(seen.url?.searchParams.get("status")).toBe("APPROVED");
    expect(seen.url?.searchParams.get("query")).toBe("kahve");
    expect(seen.url?.searchParams.has("approved")).toBe(false);
    expect(seen.url?.searchParams.get("page")).toBe("1");
    expect(seen.url?.searchParams.get("size")).toBe("40");
    expect(seen.url?.searchParams.get("sort")).toBe("name,asc");
  });

  it("never sends a sort field CompanyManager would reject", async () => {
    // COMPANY_SORTABLE is {createdAt, name}; anything else is a 400.
    const seen = watchQueue();

    await getCompanies("ACCESS-TOKEN", {
      status: "REJECTED",
      query: null,
      paging: readPaging({ sirala: "taxNumber,asc" }, COMPANY_PAGING),
    });

    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("parses only the safe CompanyReviewDto fields returned by the queue", async () => {
    watchQueue([REVIEW_COMPANY]);

    const page = await getCompanies("ACCESS-TOKEN", {
      status: "PENDING",
      query: null,
      paging: readPaging({}, COMPANY_PAGING),
    });

    expect(page.content[0]).toEqual(SAFE_REVIEW_COMPANY);
    expect(JSON.stringify(page.content[0])).not.toContain("contact@koala.test");
  });

  it("survives nullable review metadata", async () => {
    watchQueue([
      {
        id: "9c000000-0000-4000-8000-000000000002",
        name: "Yeni Şirket",
        approvalStatus: "PENDING",
      },
    ]);

    const page = await getCompanies("ACCESS-TOKEN", {
      status: "PENDING",
      query: null,
      paging: readPaging({}, COMPANY_PAGING),
    });

    expect(page.content[0]?.approvalNote).toBeNull();
    expect(page.content[0]?.approvalDecidedAt).toBeNull();
    expect(page.content[0]?.createdAt).toBeNull();
    expect(page.content[0]?.createdBy).toBeNull();
    expect(page.content[0]?.address).toBeNull();
    expect(page.content[0]?.galleryImageIds).toEqual([]);
  });

  it("keeps the registered address and gallery ids and drops storage keys", async () => {
    watchQueue([REVIEW_COMPANY]);

    const page = await getCompanies("ACCESS-TOKEN", {
      status: "PENDING",
      query: null,
      paging: readPaging({}, COMPANY_PAGING),
    });

    const review = page.content[0];
    expect(review?.address).toEqual(SAFE_REVIEW_COMPANY.address);
    expect(review?.galleryImageIds).toEqual(SAFE_REVIEW_COMPANY.galleryImageIds);
    expect(JSON.stringify(review)).not.toContain("store.test");
    expect(JSON.stringify(review)).not.toContain("storageKey");
    expect(JSON.stringify(review)).not.toContain("s3://");
  });
});

describe("the company object GET", () => {
  it("loads GET /admin/companies/{id} with the same review DTO as the queue", async () => {
    let url: string | null = null;
    let authorization: string | null = null;

    server.use(
      http.get(`${COMPANIES}/:companyId`, ({ request }) => {
        url = request.url;
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          message: "Şirket getirildi.",
          httpStatus: "200 OK",
          path: `/admin/companies/${COMPANY_ID}`,
          requestId: "rid-company",
          timeStamp: "2026-09-12T00:00:00.000000000Z",
          data: REVIEW_COMPANY,
        });
      }),
    );

    const company = await getCompany("ACCESS-TOKEN", COMPANY_ID);

    expect(url).toBe(`${COMPANIES}/${COMPANY_ID}`);
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(company).toEqual(SAFE_REVIEW_COMPANY);
  });

  it("escapes the company id on the object path", async () => {
    let url: string | null = null;
    server.use(
      http.get(`${COMPANIES}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await getCompany("ACCESS-TOKEN", "../../me").catch(() => undefined);

    expect(url).toContain("%2F");
  });
});

describe("the staff gallery download path", () => {
  it("encodes both identifiers instead of interpolating them", () => {
    expect(companyImageDownloadPath("../../me", "x/y")).toBe(
      "/admin/companies/..%2F..%2Fme/images/x%2Fy/download",
    );
  });
});

describe("approving a company", () => {
  it("posts the approval note and parses the review response", async () => {
    let contentType: string | null = null;
    let body: unknown = null;
    let url: string | null = null;

    server.use(
      http.post(`${COMPANIES}/:companyId/approve`, async ({ request }) => {
        url = request.url;
        contentType = request.headers.get("content-type");
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Şirket onaylandı.",
          httpStatus: "200 OK",
          path: "/admin/companies/9c000000-0000-4000-8000-000000000001/approve",
          requestId: "rid-approve",
          timeStamp: "2026-09-06T09:41:00.000000000Z",
          data: {
            ...REVIEW_COMPANY,
            approvalStatus: "APPROVED",
            approvalNote: "Vergi levhası doğrulandı.",
            approvalDecidedAt: "2026-09-06T09:41:00Z",
          },
        });
      }),
    );

    const approved = await approveCompany("ACCESS-TOKEN", COMPANY_ID, "Vergi levhası doğrulandı.");

    expect(url).toBe(`${COMPANIES}/${COMPANY_ID}/approve`);
    expect(body).toEqual({ note: "Vergi levhası doğrulandı." });
    expect(contentType).toBe("application/json");
    expect(approved.approvalStatus).toBe("APPROVED");
  });

  it("escapes the company id rather than pasting it into a path", async () => {
    let url: string | null = null;
    server.use(
      http.post(`${COMPANIES}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await approveCompany("ACCESS-TOKEN", "../../me", "Kontrol edildi.").catch(() => undefined);

    expect(url).toContain("%2F");
  });
});

describe("rejecting a company", () => {
  it("posts the rejection reason to the reject endpoint", async () => {
    let body: unknown = null;
    let url: string | null = null;
    let authorization: string | null = null;

    server.use(
      http.post(`${COMPANIES}/:companyId/reject`, async ({ request }) => {
        url = request.url;
        authorization = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Şirket reddedildi.",
          data: {
            ...REVIEW_COMPANY,
            approvalStatus: "REJECTED",
            approvalNote: "Vergi levhası okunmuyor.",
            approvalDecidedAt: "2026-09-06T09:42:00Z",
          },
        });
      }),
    );

    const rejected = await rejectCompany("ACCESS-TOKEN", COMPANY_ID, "Vergi levhası okunmuyor.");

    expect(url).toBe(`${COMPANIES}/${COMPANY_ID}/reject`);
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(body).toEqual({ reason: "Vergi levhası okunmuyor." });
    expect(rejected.approvalStatus).toBe("REJECTED");
  });

  it("escapes the company id before building the rejection path", async () => {
    let url: string | null = null;
    server.use(
      http.post(`${COMPANIES}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await rejectCompany("ACCESS-TOKEN", "../../me", "Kontrol edildi.").catch(() => undefined);

    expect(url).toContain("%2F");
    expect(url).toContain("/reject");
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

  it("names the safe creator by their name, falling back to the username", () => {
    expect(
      safeUserDisplayName({
        id: "u1",
        firstName: "Ayşe",
        lastName: "Yılmaz",
        username: "ayse",
        profilePictureUrl: null,
      }),
    ).toBe("Ayşe Yılmaz");

    expect(
      safeUserDisplayName({
        id: "u2",
        firstName: null,
        lastName: null,
        username: "mehmet",
        profilePictureUrl: null,
      }),
    ).toBe("mehmet");

    expect(safeUserDisplayName(null)).toBeNull();
  });

  it("labels every current decision status and exposes a future one verbatim", () => {
    expect(companyApprovalStatusLabel("PENDING")).toBe("Onay bekliyor");
    expect(companyApprovalStatusLabel("APPROVED")).toBe("Onaylı");
    expect(companyApprovalStatusLabel("REJECTED")).toBe("Reddedildi");
    expect(companyApprovalStatusLabel("SUSPENDED")).toBe("SUSPENDED");
  });
});
