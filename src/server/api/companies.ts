import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * The company approval queue's contract with `webAPI/AdminController.java`.
 *
 * The two endpoints, in full:
 *
 * ```java
 * @GetMapping("/companies")   companies(@RequestParam(defaultValue = "false") boolean approved, Pageable)
 * @PostMapping("/companies/{companyId}/approve")   approveCompany(@PathVariable UUID companyId)
 * ```
 *
 * Read the second one again: **there is no request body and there is no
 * counterpart.** No rejection endpoint, no un-approve, no "request more
 * documents" — approval is the only transition a staff member can make, and it
 * is one-way. `CompanyManager.approveCompany` answers 409 for a company that is
 * already approved and sends no notification to anybody.
 *
 * The panel does not invent any of the missing halves. {@link COMPANY_BACKEND_GAPS}
 * is the list, it is rendered on the screen, and it is what the backend issue
 * should be written from.
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

/** `core/dtos/companyContact/response/CompanyContactDto.java`. */
const companyContactSchema = z.object({
  id: z.string(),
  user: safeUserSchema.nullish().transform((value) => value ?? null),
  /** `CompanyContactRole`: ADMIN or STAFF. Left as a string for the same reason as elsewhere. */
  role: nullableString,
});

/**
 * `core/dtos/address/response/AddressDto.java`, narrowed to what the screen
 * shows. Zod strips the rest, so a field added there does not break this page.
 */
const addressSchema = z.object({
  displayAddress: nullableString,
  cityName: nullableString,
  districtName: nullableString,
  countryName: nullableString,
});

/** `core/dtos/gallery/response/GalleryImageDto.java`. */
const galleryImageSchema = z.object({
  id: z.string(),
  url: nullableString,
  caption: nullableString,
});

/**
 * `core/dtos/company/response/CompanyDto.java`.
 *
 * Note what is *not* in it and therefore not below: `createdAt` and the user
 * who created the record. `Company extends BaseEntity`, so both exist in the
 * database (`created_at`, `created_by_id`) — the mapper simply does not carry
 * them. koala-admin#8 asks for "oluşturan, tarih" in the queue and neither can
 * be shown; see {@link COMPANY_BACKEND_GAPS}.
 */
export const companySchema = z.object({
  id: z.string(),
  name: nullableString,
  email: nullableString,
  logoUrl: nullableString,
  phoneNumber: nullableString,
  website: nullableString,
  description: nullableString,
  taxNumber: nullableString,
  type: nullableString,
  address: addressSchema.nullish().transform((value) => value ?? null),
  companyContacts: z
    .array(companyContactSchema)
    .nullish()
    .transform((value) => value ?? []),
  images: z
    .array(galleryImageSchema)
    .nullish()
    .transform((value) => value ?? []),
  approved: z.boolean(),
});

export type Company = z.infer<typeof companySchema>;
export type CompanyContact = z.infer<typeof companyContactSchema>;

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

const CONTACT_ROLE_LABELS: Record<string, string> = {
  ADMIN: "Şirket yetkilisi",
  STAFF: "Şirket çalışanı",
};

/** Falls back to the raw code so a new `CompanyType` is legible, not blank. */
export function companyTypeLabel(type: string | null): string | null {
  if (type === null) return null;
  return TYPE_LABELS[type] ?? type;
}

export function companyContactRoleLabel(role: string | null): string | null {
  if (role === null) return null;
  return CONTACT_ROLE_LABELS[role] ?? role;
}

/** `SafeUserDto` has no email; a name is the most the panel can print. */
export function contactDisplayName(contact: CompanyContact): string | null {
  const user = contact.user;
  if (user === null) return null;

  const name = [user.firstName, user.lastName].filter(Boolean).join(" ").trim();
  if (name.length > 0) return name;

  return user.username;
}

export interface CompanyQueueQuery {
  /** `false` is the default view: the companies waiting for a decision. */
  readonly approved: boolean;
  readonly paging: Paging;
}

export function getCompanies(
  accessToken: string,
  query: CompanyQueueQuery,
): Promise<PageDto<Company>> {
  return koalaApi.get({
    path: COMPANIES_PATH,
    schema: pageDtoSchema(companySchema),
    query: { approved: query.approved, ...pagingQuery(query.paging) },
    accessToken,
    cache: "no-store",
  });
}

/**
 * The panel's floor for an approval note.
 *
 * Lives here rather than beside the Server Action because a `"use server"`
 * module may only export async functions. See {@link COMPANY_BACKEND_GAPS} for
 * where the note ends up — which is not the backend, because
 * `POST /admin/companies/{companyId}/approve` takes no body.
 */
export const APPROVAL_MIN_NOTE_LENGTH = 10;

/**
 * `POST /admin/companies/{companyId}/approve`.
 *
 * **No body on purpose.** The controller method takes only `@PathVariable UUID
 * companyId`; sending JSON it does not read would be a lie told in code, and
 * would let a reader believe the approval note is stored somewhere.
 * `koalaRequest` omits the body — and the `Content-Type` header with it —
 * whenever `body` is `undefined`, so nothing is sent.
 */
export function approveCompany(accessToken: string, companyId: string): Promise<Company> {
  return koalaApi.post({
    path: `${COMPANIES_PATH}/${encodeURIComponent(companyId)}/approve`,
    schema: companySchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * What koala-admin#8 asks for that `AdminController` cannot do today.
 *
 * The first entry is the one that needs a backend issue: an approval queue with
 * no rejection path means a company that should never be approved just sits in
 * the queue for ever, and every operator who opens it has to work out again
 * that there is nothing to do.
 */
export const COMPANY_BACKEND_GAPS = [
  {
    id: "no-rejection",
    title: "Ret yolu yok",
    detail:
      "`AdminController`'da yalnızca `POST /admin/companies/{companyId}/approve` var. Reddetme, onayı geri alma ya da 'eksik belge iste' ucu yok. Reddedilmesi gereken bir başvuru kuyrukta kalmaya devam eder; panel bunun için bir düğme uydurmuyor.",
  },
  {
    id: "no-note",
    title: "Onay gerekçesi backend'e gönderilemiyor",
    detail:
      "Onay ucu gövde kabul etmiyor (`@PathVariable` dışında parametresi yok). Panel gerekçeyi yine de zorunlu tutar ve sunucu günlüğüne yazar; kalıcı kayıt koala-backend#15'in denetim kaydıyla gelecek.",
  },
  {
    id: "no-created-at",
    title: "Başvuru tarihi ve başvuruyu oluşturan dönmüyor",
    detail:
      "`Company` `BaseEntity`'den geliyor, yani `created_at` ve `created_by_id` veritabanında var; `CompanyDto` ikisini de taşımıyor. Bu yüzden kuyrukta 'tarih' ve 'oluşturan' sütunları yok. Panel yetkili kişileri gösterir — bunlar başvuruyu açan kişi ile aynı olmak zorunda değildir.",
  },
  {
    id: "no-documents",
    title: "Belge diye ayrı bir alan yok",
    detail:
      "`CompanyDto` yalnızca logo ve galeri görselleri döndürüyor; vergi levhası, imza sirküleri gibi belgeler için ayrı bir alan ya da uç bulunmuyor. Ekranda görülen 'belgeler', şirketin galeri görselleridir.",
  },
  {
    id: "no-notification",
    title: "Onay sonrası şirkete bildirim gitmiyor",
    detail:
      "`CompanyManager.approveCompany` yalnızca `isApproved` alanını değiştirip log yazıyor; `notificationService` çağrılmıyor. Şirket oluşturulurken iki e-posta gönderiliyor ama onaylandığında hiçbiri gönderilmiyor. Şirket sahibi onaylandığını panelden öğrenemez.",
  },
  {
    id: "no-search",
    title: "Ada ya da vergi numarasına göre arama yok",
    detail:
      "`GET /admin/companies` tek süzgeç olarak `approved` alıyor. Belirli bir şirketi bulmak için sayfalar arasında gezmek gerekir; panel gelen sayfayı kendi içinde aramaz, çünkü bu yalnızca o sayfayı aramak olurdu.",
  },
] as const;
