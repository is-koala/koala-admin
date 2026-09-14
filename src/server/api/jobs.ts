import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
import { pricingBreakdownSchema } from "./shared/pricing";
import { staffPartySchema } from "./shared/staff-party";
import type { PageDto } from "./types";

/**
 * İlanlar — `AdminController.jobs` / `job` (koala-backend#265).
 *
 * ```java
 * GET /admin/jobs?status=&query=&page=&size=&sort=   job.read
 * GET /admin/jobs/{jobId}                            job.read
 * ```
 *
 * `status` tekrarlanabilir (`List<JobStatus>`); verilmezse her durum döner.
 * `query` (2–100) ilan id'si, başlığı, şirket adı ve işverenin ad-soyadı ile
 * e-postasında arar. İşveren `StaffPartyDto` — e-posta **var**; izin bu
 * yüzden PERSONAL_DATA. Detay adresi ADR-0003'ün yaklaşık konum kuralına
 * uymaz: personel tam adresi görür, backend bunu bilerek böyle döner.
 *
 * `startDateTime` / `endDateTime` ofsetsiz `LocalDateTime`; `formatWallClock`
 * ile yazılır, `new Date` ile değil.
 */

/** `entities/JobStatus.java`. */
export const JOB_STATUSES = ["OPEN", "CLOSED", "CANCELLED"] as const;

export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_STATUS_LABELS: Record<JobStatus, string> = {
  OPEN: "Açık",
  CLOSED: "Kapalı",
  CANCELLED: "İptal",
};

export const JOB_EMPLOYER_TYPES = ["COMPANY", "INDIVIDUAL"] as const;
export type JobEmployerType = (typeof JOB_EMPLOYER_TYPES)[number];

export const JOB_EMPLOYER_TYPE_LABELS: Record<JobEmployerType, string> = {
  COMPANY: "Şirket",
  INDIVIDUAL: "Bireysel",
};

export const JOB_TYPES = ["ONE_TIME", "RECURRING"] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_TYPE_LABELS: Record<JobType, string> = {
  ONE_TIME: "Tek seferlik",
  RECURRING: "Tekrarlayan",
};

export const SALARY_TYPES = ["HOURLY", "DAILY"] as const;
export type SalaryType = (typeof SALARY_TYPES)[number];

export const SALARY_TYPE_LABELS: Record<SalaryType, string> = {
  HOURLY: "Saatlik",
  DAILY: "Günlük",
};

export const JOBS_PATH = "/admin/jobs";

/** `JobManager.SORTABLE_FIELDS` / `DEFAULT_SORT` `createdAt,desc`. */
export const JOB_PAGING: PagingContract = {
  sortable: ["createdAt", "salary", "startDateTime", "title"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export function jobPath(jobId: string): string {
  return `${JOBS_PATH}/${encodeURIComponent(jobId)}`;
}

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);

const nullableBoolean = z
  .boolean()
  .nullish()
  .transform((value) => value ?? null);

/** `BigDecimal` — sayı ya da metin gelebilir, dönüştürülmez. */
const nullableMoney = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => value ?? null);

/** `AdminJobDto` — liste satırı. */
export const adminJobSchema = z.object({
  id: z.string(),
  title: nullableString,
  status: z.enum(JOB_STATUSES),
  employerType: z
    .enum(JOB_EMPLOYER_TYPES)
    .nullish()
    .transform((value) => value ?? null),
  type: z
    .enum(JOB_TYPES)
    .nullish()
    .transform((value) => value ?? null),
  salaryType: z
    .enum(SALARY_TYPES)
    .nullish()
    .transform((value) => value ?? null),
  salary: nullableMoney,
  pricing: pricingBreakdownSchema.nullish().transform((value) => value ?? null),
  startDateTime: nullableString,
  endDateTime: nullableString,
  employer: staffPartySchema.nullish().transform((value) => value ?? null),
  companyId: nullableString,
  companyName: nullableString,
  cityName: nullableString,
  districtName: nullableString,
  headcount: nullableInt,
  applicationCount: nullableInt,
  assignmentCount: nullableInt,
  createdAt: nullableString,
  updatedAt: nullableString,
});

export type AdminJob = z.infer<typeof adminJobSchema>;

/** `JobCategoryDto`. */
const jobCategorySchema = z.object({
  id: z.string(),
  name: nullableString,
  code: nullableString,
  requiresInsurance: nullableBoolean,
});

/** `JobCompanyDto` — ilanın şirketi; vergi numarası da gelir. */
const jobCompanySchema = z.object({
  id: z.string(),
  name: nullableString,
  email: nullableString,
  phoneNumber: nullableString,
  website: nullableString,
  taxNumber: nullableString,
  type: nullableString,
});

/** `AddressComponentsDto`. */
const addressComponentsSchema = z.object({
  neighborhood: nullableString,
  thoroughfare: nullableString,
  siteName: nullableString,
  block: nullableString,
  buildingName: nullableString,
  buildingNumber: nullableString,
  floor: nullableString,
  unitNumber: nullableString,
  postalCode: nullableString,
  additionalDirections: nullableString,
});

/** `AddressDto` — personel için tam adres. */
export const addressSchema = z.object({
  id: nullableString,
  countryName: nullableString,
  cityName: nullableString,
  districtName: nullableString,
  components: addressComponentsSchema.nullish().transform((value) => value ?? null),
  displayAddress: nullableString,
  needsReview: nullableBoolean,
});

export type JobAddress = z.infer<typeof addressSchema>;

/** `GalleryImageDto`. */
const galleryImageSchema = z.object({
  id: z.string(),
  url: nullableString,
  sortOrder: nullableInt,
  cover: nullableBoolean,
  caption: nullableString,
});

export type JobImage = z.infer<typeof galleryImageSchema>;

/** `AdminJobDetailDto` — satırın üst kümesi. */
export const adminJobDetailSchema = adminJobSchema.extend({
  description: nullableString,
  duties: nullableString,
  sector: nullableString,
  position: nullableString,
  dressCode: nullableString,
  category: jobCategorySchema.nullish().transform((value) => value ?? null),
  minAge: nullableInt,
  maxAge: nullableInt,
  insuranceRequired: nullableBoolean,
  experienceRequired: nullableBoolean,
  company: jobCompanySchema.nullish().transform((value) => value ?? null),
  address: addressSchema.nullish().transform((value) => value ?? null),
  addressPublic: nullableBoolean,
  images: z.array(galleryImageSchema).default([]),
});

export type AdminJobDetail = z.infer<typeof adminJobDetailSchema>;

export interface JobQueueQuery {
  readonly paging: Paging;
  /** `null` her durum demektir — backend'e `status` gitmez. */
  readonly status?: JobStatus | null;
  readonly query?: string | null;
  /** koala-backend#283: yalnız bu şirketin ilanları; durum ve arama ile kesişir. */
  readonly companyId?: string | null;
  /** koala-backend#283: yalnız bu işverenin (ilan sahibinin) ilanları. */
  readonly employerId?: string | null;
}

export function getAdminJobs(
  accessToken: string,
  query: JobQueueQuery,
): Promise<PageDto<AdminJob>> {
  return koalaApi.get({
    path: JOBS_PATH,
    schema: pageDtoSchema(adminJobSchema),
    query: {
      ...(query.status ? { status: query.status } : {}),
      query: searchQueryParam(query.query),
      companyId: query.companyId ?? undefined,
      employerId: query.employerId ?? undefined,
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export function getAdminJob(accessToken: string, jobId: string): Promise<AdminJobDetail> {
  return koalaApi.get({
    path: jobPath(jobId),
    schema: adminJobDetailSchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * Tam adresin tek satırı. Backend `displayAddress` üretmişse o; yoksa
 * bileşenler doldurulmuş sırayla birleştirilir. Panel adres uydurmaz — boş
 * bileşenler atlanır, il/ilçe sona eklenir.
 */
export function formatJobAddress(address: JobAddress | null): string | null {
  if (address === null) return null;
  if (address.displayAddress !== null && address.displayAddress.trim().length > 0) {
    return address.displayAddress;
  }

  const c = address.components;
  const parts = [
    c?.neighborhood,
    c?.thoroughfare,
    c?.siteName,
    c?.block === null || c?.block === undefined ? null : `Blok ${c.block}`,
    c?.buildingName,
    c?.buildingNumber === null || c?.buildingNumber === undefined ? null : `No ${c.buildingNumber}`,
    c?.floor === null || c?.floor === undefined ? null : `Kat ${c.floor}`,
    c?.unitNumber === null || c?.unitNumber === undefined ? null : `Daire ${c.unitNumber}`,
    c?.postalCode,
    address.districtName,
    address.cityName,
    address.countryName,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);

  return parts.length === 0 ? null : parts.join(", ");
}
