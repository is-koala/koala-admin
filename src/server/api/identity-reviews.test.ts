import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { readPaging } from "./paging";
import {
  IDENTITY_REVIEW_PAGING,
  approveIdentityReview,
  getIdentityReview,
  getIdentityReviews,
  identityDocumentDownloadPath,
  identityReviewStatusLabel,
  rejectIdentityReview,
} from "./identity-reviews";

const REVIEWS = apiUrl("/admin/identity-verifications");
const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";

const PENDING_REVIEW = {
  id: REVIEW_ID,
  userId: "b2000000-0000-4000-8000-000000000002",
  firstName: "Yusuf",
  lastName: "Acmaci",
  tcIdentityNumber: "10000000146",
  tcDocumentNumber: "A01A00000",
  birthDate: "1998-04-12",
  status: "PENDING",
  rejectionReason: null,
  rejectedAt: null,
  verifiedAt: null,
  reviewedByStaffId: null,
  frontDocumentId: "c3000000-0000-4000-8000-000000000003",
  backDocumentId: "d4000000-0000-4000-8000-000000000004",
  createdAt: "2026-09-11T12:00:00Z",
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function watchQueue(content: unknown[] = [PENDING_REVIEW]) {
  const seen: { url: URL | null; authorization: string | null } = {
    url: null,
    authorization: null,
  };

  server.use(
    http.get(REVIEWS, ({ request }) => {
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "İncelemeler listelendi.",
        httpStatus: "200 OK",
        path: "/admin/identity-verifications",
        requestId: "rid-identity",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
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

describe("the identity review queue", () => {
  it("asks the backend for the pending page by default", async () => {
    const seen = watchQueue();

    await getIdentityReviews("ACCESS-TOKEN", {
      status: "PENDING",
      paging: readPaging({}, IDENTITY_REVIEW_PAGING),
    });

    expect(seen.url?.searchParams.get("status")).toBe("PENDING");
    expect(seen.url?.searchParams.get("page")).toBe("0");
    expect(seen.url?.searchParams.get("size")).toBe("20");
    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
  });

  it("never sends a sort field the backend would reject", async () => {
    const seen = watchQueue();

    await getIdentityReviews("ACCESS-TOKEN", {
      status: "REJECTED",
      paging: readPaging({ sirala: "tcIdentityNumber,asc" }, IDENTITY_REVIEW_PAGING),
    });

    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("strips unknown fields from IdentityReviewDto", async () => {
    watchQueue([{ ...PENDING_REVIEW, fileUrl: "s3://secret", sod: "c29k" }]);

    const page = await getIdentityReviews("ACCESS-TOKEN", {
      status: "PENDING",
      paging: readPaging({}, IDENTITY_REVIEW_PAGING),
    });

    expect(page.content[0]).toEqual(PENDING_REVIEW);
    expect(page.content[0]).not.toHaveProperty("fileUrl");
    expect(page.content[0]).not.toHaveProperty("sod");
  });

  it("names the three review statuses in Turkish", () => {
    expect(identityReviewStatusLabel("PENDING")).toBe("Onay bekliyor");
    expect(identityReviewStatusLabel("APPROVED")).toBe("Onaylı");
    expect(identityReviewStatusLabel("REJECTED")).toBe("Reddedildi");
  });
});

describe("the identity review object", () => {
  it("loads GET /admin/identity-verifications/{id} with the same DTO as the queue", async () => {
    let url: string | null = null;
    let authorization: string | null = null;

    server.use(
      http.get(`${REVIEWS}/:reviewId`, ({ request }) => {
        url = request.url;
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          message: "Kimlik incelemesi getirildi.",
          httpStatus: "200 OK",
          path: `/admin/identity-verifications/${REVIEW_ID}`,
          requestId: "rid-identity-one",
          timeStamp: "2026-09-11T12:00:00.000000000Z",
          data: { ...PENDING_REVIEW, fileUrl: "s3://secret" },
        });
      }),
    );

    const review = await getIdentityReview("ACCESS-TOKEN", REVIEW_ID);

    expect(url).toBe(`${REVIEWS}/${REVIEW_ID}`);
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(review).toEqual(PENDING_REVIEW);
    expect(review).not.toHaveProperty("fileUrl");
  });

  it("escapes the review id on the object path", async () => {
    let url: string | null = null;
    server.use(
      http.get(`${REVIEWS}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await getIdentityReview("ACCESS-TOKEN", "../../me").catch(() => undefined);

    expect(url).toContain("%2F");
  });
});

describe("deciding an identity review", () => {
  it("approves without a body so no unused note is invented", async () => {
    let body: string | null = null;
    let url: string | null = null;

    server.use(
      http.post(`${REVIEWS}/:reviewId/approve`, async ({ request }) => {
        url = request.url;
        body = await request.text();
        return HttpResponse.json({
          success: true,
          message: "Kimlik onaylandı.",
          httpStatus: "200 OK",
          path: `/admin/identity-verifications/${REVIEW_ID}/approve`,
          requestId: "rid-approve",
          timeStamp: "2026-09-11T12:01:00.000000000Z",
          data: { ...PENDING_REVIEW, status: "APPROVED", verifiedAt: "2026-09-11T12:01:00Z" },
        });
      }),
    );

    const approved = await approveIdentityReview("ACCESS-TOKEN", REVIEW_ID);

    expect(url).toBe(`${REVIEWS}/${REVIEW_ID}/approve`);
    expect(body).toBe("");
    expect(approved.status).toBe("APPROVED");
  });

  it("posts only the rejection reason", async () => {
    let body: unknown = null;

    server.use(
      http.post(`${REVIEWS}/:reviewId/reject`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "İnceleme reddedildi.",
          httpStatus: "200 OK",
          path: `/admin/identity-verifications/${REVIEW_ID}/reject`,
          requestId: "rid-reject",
          timeStamp: "2026-09-11T12:02:00.000000000Z",
          data: {
            ...PENDING_REVIEW,
            status: "REJECTED",
            rejectionReason: "Fotoğraflar okunaksız",
            rejectedAt: "2026-09-11T12:02:00Z",
          },
        });
      }),
    );

    const rejected = await rejectIdentityReview("ACCESS-TOKEN", REVIEW_ID, "Fotoğraflar okunaksız");

    expect(body).toEqual({ reason: "Fotoğraflar okunaksız" });
    expect(rejected.status).toBe("REJECTED");
  });

  it("escapes the review id rather than pasting it into a path", async () => {
    let url: string | null = null;
    server.use(
      http.post(`${REVIEWS}/*`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await approveIdentityReview("ACCESS-TOKEN", "../../me").catch(() => undefined);

    expect(url).toContain("/admin/identity-verifications/..%2F..%2Fme/approve");
  });

  it("escapes identifiers in the staff download path rather than pasting them", () => {
    expect(identityDocumentDownloadPath("../../me", "x/y")).toBe(
      "/admin/identity-verifications/..%2F..%2Fme/documents/x%2Fy/download",
    );
  });
});
