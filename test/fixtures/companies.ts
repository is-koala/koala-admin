import type { CompanyReview } from "../../src/server/api/companies";

export const COMPANY_REVIEW_ID = "9c000000-0000-4000-8000-000000000001";
export const COMPANY_GALLERY_IMAGE_ID = "a1000000-0000-4000-8000-0000000000aa";

export type CompanyReviewOverrides = Partial<CompanyReview>;

/** One safe `CompanyReviewDto`, shared by contract, action and page tests. */
export function reviewCompany(overrides: CompanyReviewOverrides = {}): CompanyReview {
  return {
    id: COMPANY_REVIEW_ID,
    name: "Koala Kahve A.Ş.",
    email: "info@koalakahve.test",
    phoneNumber: "+905551112233",
    taxNumber: "1234567890",
    type: "CORPORATION",
    logoUrl: null,
    website: null,
    description: null,
    approvalStatus: "PENDING",
    approvalNote: null,
    approvalDecidedAt: null,
    approvedByStaffId: null,
    createdAt: "2026-09-01T08:00:00Z",
    createdBy: {
      id: "u1",
      firstName: "Ayşe",
      lastName: "Yılmaz",
      username: "ayse",
      profilePictureUrl: null,
    },
    address: {
      displayAddress: "Caferağa Mah. Moda Cad. No:12, Kadıköy",
      countryName: "Türkiye",
      cityName: "İstanbul",
      districtName: "Kadıköy",
    },
    galleryImageIds: [COMPANY_GALLERY_IMAGE_ID],
    companyContacts: null,
    jobCount: null,
    ...overrides,
  };
}
