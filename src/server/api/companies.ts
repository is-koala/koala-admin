import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * The company approval queue's contract with `webAPI/AdminController.java`.
 *
 * The four endpoints, in full:
 *
 * ```java
 * GET  /admin/companies?status=PENDING|APPROVED|REJECTED&query=...
 * GET  /admin/companies/{companyId}
 * GET  /admin/companies/{companyId}/images/{imageId}/download
 * POST /admin/companies/{companyId}/approve   { note }
 * POST /admin/companies/{companyId}/reject    { reason }
 * ```
 *
 * Both mutations return the updated `CompanyReviewDto`. Approval accepts a
 * rejected application but cannot be undone; rejection only accepts a pending
 * application. Successful decisions persist the note and trigger backend
 * notifications for the company's ADMIN contacts.
 */

export const COMPANIES_PATH = "/admin/companies";

/** `CompanyManager.COMPANY_SORTABLE` and `COMPANY_SORT`, copied. */
export const COMPANY_PAGING: PagingContract = {
  sortable: ["createdAt", "name"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/** `core/dtos/user/response/SafeUserDto.java`. */
const safeUserSchema = z.object({
  id: z.string(),
  firstName: nullableString,
  lastName: nullableString,
  username: nullableString,
  profilePictureUrl: nullableString,
});

/**
 * `core/dtos/address/response/AddressDto.java`, only the names operators read.
 * Position, components and ids stay off the page.
 */
const companyAddressSchema = z
  .object({
    displayAddress: nullableString,
    countryName: nullableString,
    cityName: nullableString,
    districtName: nullableString,
  })
  .nullish()
  .transform((value) => value ?? null);

/** `CompanyContactRole.java`. */
export const COMPANY_CONTACT_ROLES = ["ADMIN", "STAFF"] as const;
export type CompanyContactRole = (typeof COMPANY_CONTACT_ROLES)[number];

const CONTACT_ROLE_LABELS: Record<CompanyContactRole, string> = {
  ADMIN: "Yetkili",
  STAFF: "Personel",
};

export function companyContactRoleLabel(role: string | null): string {
  if (role === null) return "—";
  return (CONTACT_ROLE_LABELS as Readonly<Record<string, string>>)[role] ?? role;
}

/** `CompanyContactDto` — yetkili: kullanıcı (`SafeUserDto`) ve şirketteki rolü. */
export const companyContactSchema = z.object({
  id: z.string(),
  user: safeUserSchema.nullish().transform((value) => value ?? null),
  role: nullableString,
});

export type CompanyContact = z.infer<typeof companyContactSchema>;

/**
 * `core/dtos/company/response/CompanyReviewDto.java`.
 *
 * Address and gallery image ids are on the review DTO; storage keys are not.
 * Zod strips unknown fields, including any accidental expansion of
 * `createdBy`, so the page can only render the backend's safe projection.
 *
 * koala-backend#283 alanları — yetkililer, web sitesi, açıklama, kararı veren
 * personel, ilan sayısı — isteğe bağlı: eski sunucu göndermez, sayfa
 * bölümü gizler. `companyContacts` `null` (sunucu vermedi) ile `[]`
 * (yetkili yok) ayrımını korur.
 */
export const companyReviewSchema = z.object({
  id: z.string(),
  name: nullableString,
  email: nullableString,
  phoneNumber: nullableString,
  taxNumber: nullableString,
  type: nullableString,
  logoUrl: nullableString,
  website: nullableString,
  description: nullableString,
  approvalStatus: z.string(),
  approvalNote: nullableString,
  approvalDecidedAt: nullableString,
  approvedByStaffId: nullableString,
  createdAt: nullableString,
  createdBy: safeUserSchema.nullish().transform((value) => value ?? null),
  address: companyAddressSchema,
  galleryImageIds: z
    .array(z.string())
    .nullish()
    .transform((value) => value ?? []),
  companyContacts: z
    .array(companyContactSchema)
    .nullish()
    .transform((value) => value ?? null),
  jobCount: z
    .number()
    .int()
    .nonnegative()
    .nullish()
    .transform((value) => value ?? null),
});

export type CompanyReview = z.infer<typeof companyReviewSchema>;
export type SafeUser = z.infer<typeof safeUserSchema>;

export const COMPANY_APPROVAL_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type CompanyApprovalStatus = (typeof COMPANY_APPROVAL_STATUSES)[number];

const TYPE_LABELS: Record<string, string> = {
  SOLE_PROPRIETORSHIP: "Şahıs şirketi",
  LIMITED: "Limited şirket",
  CORPORATION: "Anonim şirket",
  NON_PROFIT: "Kâr amacı gütmeyen",
  GOVERNMENT: "Kamu kurumu",
  STARTUP: "Girişim",
  AGENCY: "Ajans",
  OTHER: "Diğer",
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "Onay bekliyor",
  APPROVED: "Onaylı",
  REJECTED: "Reddedildi",
};

/** Falls back to the raw code so a new `CompanyType` is legible, not blank. */
export function companyTypeLabel(type: string | null): string | null {
  if (type === null) return null;
  return TYPE_LABELS[type] ?? type;
}

export function companyApprovalStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/** `SafeUserDto` has no email; a name is the most the panel can print. */
export function safeUserDisplayName(user: SafeUser | null): string | null {
  if (user === null) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (name.length > 0) return name;
  return user.username;
}

export interface CompanyQueueQuery {
  readonly status: CompanyApprovalStatus;
  readonly query: string | null;
  readonly paging: Paging;
}

export function getCompanies(
  accessToken: string,
  query: CompanyQueueQuery,
): Promise<PageDto<CompanyReview>> {
  return koalaApi.get({
    path: COMPANIES_PATH,
    schema: pageDtoSchema(companyReviewSchema),
    query: {
      status: query.status,
      query: query.query?.trim() || undefined,
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export function companyDetailPath(companyId: string): string {
  return `${COMPANIES_PATH}/${encodeURIComponent(companyId)}`;
}

/** `GET /admin/companies/{companyId}` — same CompanyReviewDto as the queue. */
export function getCompany(accessToken: string, companyId: string): Promise<CompanyReview> {
  return koalaApi.get({
    path: companyDetailPath(companyId),
    schema: companyReviewSchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * The panel's floor for a decision note.
 *
 * Lives here rather than beside the Server Action because a `"use server"`
 * module may only export async functions. The backend makes an approval note
 * optional but requires a non-blank rejection reason; the panel deliberately
 * asks for a useful written reason for both.
 */
export const COMPANY_DECISION_MIN_NOTE_LENGTH = 10;
/** `@Size(max = 1000)` on both decision request DTOs. */
export const COMPANY_DECISION_MAX_NOTE_LENGTH = 1000;

/**
 * `POST /admin/companies/{companyId}/approve` with `ApproveCompanyDto.note`.
 */
export function approveCompany(
  accessToken: string,
  companyId: string,
  note: string,
): Promise<CompanyReview> {
  return koalaApi.post({
    path: `${COMPANIES_PATH}/${encodeURIComponent(companyId)}/approve`,
    schema: companyReviewSchema,
    body: { note },
    accessToken,
    cache: "no-store",
  });
}

export function companyImageDownloadPath(companyId: string, imageId: string): string {
  return `${COMPANIES_PATH}/${encodeURIComponent(companyId)}/images/${encodeURIComponent(imageId)}/download`;
}

export function rejectCompany(
  accessToken: string,
  companyId: string,
  reason: string,
): Promise<CompanyReview> {
  return koalaApi.post({
    path: `${COMPANIES_PATH}/${encodeURIComponent(companyId)}/reject`,
    schema: companyReviewSchema,
    body: { reason },
    accessToken,
    cache: "no-store",
  });
}
