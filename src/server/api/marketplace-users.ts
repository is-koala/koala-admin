import "server-only";

import { z } from "zod";

import { BADGE_FAMILY_LABELS, BADGE_TIER_LABELS } from "@/lib/badges";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";
import { safeUserSchema, type SafeUser } from "./users";

export { companyContactRoleLabel } from "./shared/company-contact-role";

/**
 * Pazaryeri kullanıcı dizini — `webAPI/AdminController.users`.
 *
 * ```java
 * GET /admin/users?query=  user.read  Pageable
 * GET /admin/users/{userId} user.read
 * ```
 *
 * `query` boşsa herkes; doluysa e-posta ve ad+soyad `LIKE`. Liste yanıtı
 * `SafeUserDto`: e-posta aramada kullanılır, cevapta yoktur. Sıralama
 * `UserManager.USER_SORTABLE` — bilinmeyen alan 400.
 *
 * Nesne ucu koala-backend#283 ile `AdminUserDetailDto` döner: `SafeUserDto`
 * + iletişim (yalnız `user.read_pii` taşıyan aktöre dolu, diğerine `null`),
 * doğrulama bayrakları, üyelikler, rozetler, geçmiş sayaçları, kimlik
 * inceleme durumu ve bekleyen silme talebi. Eski sunucu bu alanları hiç
 * göndermez; şema hepsini isteğe bağlı okur ki `SafeUserDto` dönen bir
 * sunucuda sayfa düşmesin, yalnız yeni bölümler gizlensin.
 */

export const MARKETPLACE_USERS_PATH = "/admin/users";

/** `UserManager.USER_SORTABLE` and `USER_SORT`, copied. */
export const USER_PAGING: PagingContract = {
  sortable: ["createdAt", "firstName", "lastName"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export type MarketplaceUser = SafeUser;

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableBoolean = z
  .boolean()
  .nullish()
  .transform((value) => value ?? null);

/**
 * `IdentityReviewStatus.java`. Yalnız gösterim: şema serbest dize okur,
 * etiket bilinmeyen kodu olduğu gibi yazar — bir kullanıcı sayfası yeni bir
 * inceleme durumu yüzünden düşmez.
 */
export const IDENTITY_REVIEW_STATUSES = ["PENDING", "APPROVED", "REJECTED"] as const;
export type IdentityReviewStatus = (typeof IDENTITY_REVIEW_STATUSES)[number];

const IDENTITY_REVIEW_STATUS_LABELS: Readonly<Record<string, string>> = {
  PENDING: "Bekliyor",
  APPROVED: "Onaylı",
  REJECTED: "Reddedildi",
} satisfies Record<IdentityReviewStatus, string>;

export function identityReviewStatusLabel(status: string): string {
  return IDENTITY_REVIEW_STATUS_LABELS[status] ?? status;
}

/** `AdminUserCompanyDto` — üyelik: şirket ve o şirketteki rol (`CompanyContactRole`, serbest dize). */
export const adminUserCompanySchema = z.object({
  id: z.string(),
  name: nullableString,
  role: nullableString,
});

export type AdminUserCompany = z.infer<typeof adminUserCompanySchema>;

/**
 * `BadgeDto` — kullanıcının kazandığı rozet. `family`/`tier` serbest metin:
 * katalog yeni bir aile ekleyince kullanıcı sayfası düşmesin, kodu yazsın.
 */
export const adminUserBadgeSchema = z.object({
  code: z.string(),
  family: nullableString,
  tier: nullableString,
  name: nullableString,
  description: nullableString,
  iconUrl: nullableString,
  earnedAt: nullableString,
});

export type AdminUserBadge = z.infer<typeof adminUserBadgeSchema>;

/** `AdminUserCountsDto` — sekiz geçmiş sayacı. Sayaçlar `long`, JSON sayı. */
export const adminUserCountsSchema = z.object({
  applications: z.number().int().nonnegative(),
  assignmentsAsWorker: z.number().int().nonnegative(),
  assignmentsAsEmployer: z.number().int().nonnegative(),
  payments: z.number().int().nonnegative(),
  payouts: z.number().int().nonnegative(),
  disputes: z.number().int().nonnegative(),
  reportsReceived: z.number().int().nonnegative(),
  reportsMade: z.number().int().nonnegative(),
});

export type AdminUserCounts = z.infer<typeof adminUserCountsSchema>;

/**
 * `AdminUserDetailDto`. Diziler `null` ile `[]`'i ayırır: `null` "sunucu bu
 * alanı vermedi" (eski sürüm), `[]` "kullanıcının hiç yok" demektir; sayfa
 * ilkinde bölümü gizler, ikincisinde boş cümle yazar.
 */
export const adminUserDetailSchema = safeUserSchema.extend({
  email: nullableString,
  phoneNumber: nullableString,
  emailVerified: nullableBoolean,
  phoneVerified: nullableBoolean,
  identityVerified: nullableBoolean,
  isEmployer: nullableBoolean,
  createdAt: nullableString,
  companies: z
    .array(adminUserCompanySchema)
    .nullish()
    .transform((value) => value ?? null),
  badges: z
    .array(adminUserBadgeSchema)
    .nullish()
    .transform((value) => value ?? null),
  counts: adminUserCountsSchema.nullish().transform((value) => value ?? null),
  identityReviewStatus: nullableString,
  pendingDeletionRequestId: nullableString,
});

export type MarketplaceUserDetail = z.infer<typeof adminUserDetailSchema>;

const FAMILY_LABELS: Readonly<Record<string, string>> = BADGE_FAMILY_LABELS;
const TIER_LABELS: Readonly<Record<string, string>> = BADGE_TIER_LABELS;

/** Rozet ailesi/seviyesi katalogdan tanınıyorsa Türkçesi, değilse kodu. */
export function badgeFamilyLabel(family: string | null): string | null {
  if (family === null) return null;
  return FAMILY_LABELS[family] ?? family;
}

export function badgeTierLabel(tier: string | null): string | null {
  if (tier === null) return null;
  return TIER_LABELS[tier] ?? tier;
}

export interface MarketplaceUserQuery {
  readonly query: string | null;
  readonly paging: Paging;
}

export function getMarketplaceUsers(
  accessToken: string,
  query: MarketplaceUserQuery,
): Promise<PageDto<MarketplaceUser>> {
  return koalaApi.get({
    path: MARKETPLACE_USERS_PATH,
    schema: pageDtoSchema(safeUserSchema),
    query: {
      query: query.query?.trim() || undefined,
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export function marketplaceUserPath(userId: string): string {
  return `${MARKETPLACE_USERS_PATH}/${encodeURIComponent(userId)}`;
}

/**
 * `GET /admin/users/{userId}` — `AdminUserDetailDto` (koala-backend#283);
 * eski sunucuda `SafeUserDto`, yeni alanlar `null`.
 */
export function getMarketplaceUser(
  accessToken: string,
  userId: string,
): Promise<MarketplaceUserDetail> {
  return koalaApi.get({
    path: marketplaceUserPath(userId),
    schema: adminUserDetailSchema,
    accessToken,
    cache: "no-store",
  });
}
