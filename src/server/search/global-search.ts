import "server-only";

import { z } from "zod";

import { ASSIGNMENT_STATUS_LABELS } from "@/app/(panel)/assignments/labels";
import {
  GLOBAL_SEARCH_DEFAULT_COOLDOWN_MS,
  GLOBAL_SEARCH_GROUP_SIZE,
  type GlobalSearchResponse,
  type SearchGroup,
  type SearchGroupFailure,
  type SearchGroupKind,
  type SearchHit,
  type SearchObjectKind,
} from "@/lib/global-search";
import {
  assignmentHref,
  companyHref,
  disputeHref,
  isUuid,
  jobHref,
  paymentHref,
  payoutHref,
  userHref,
} from "@/lib/panel-href";
import {
  COMPANY_APPROVAL_STATUSES,
  companyApprovalStatusLabel,
  companyDetailPath,
  getCompanies,
  type CompanyReview,
} from "@/server/api/companies";
import { disputeDetailPath } from "@/server/api/disputes";
import { isKoalaApiError } from "@/server/api/errors";
import {
  escrowSummaryPath,
  getAdminAssignments,
  ASSIGNMENT_PAGING,
  type EscrowSummary,
} from "@/server/api/escrow";
import {
  JOB_PAGING,
  JOB_STATUS_LABELS,
  getAdminJobs,
  jobPath,
  type AdminJob,
} from "@/server/api/jobs";
import { koalaApi } from "@/server/api/koala";
import {
  USER_PAGING,
  getMarketplaceUsers,
  marketplaceUserPath,
  type MarketplaceUser,
} from "@/server/api/marketplace-users";
import { paymentPath } from "@/server/api/payments";
import { payoutPath } from "@/server/api/payout-reconciliation";
import { staffPartyName } from "@/server/api/shared/staff-party";
import { isSearchQueryTooLong, searchQueryParam } from "@/server/api/search-query";
import { safeUserName } from "@/server/api/users";
import type { Permission } from "@/server/authz/permissions";

/**
 * Global arama — koala-admin#104. Backend'de birleşik bir `GET /admin/search`
 * yok (v1); panel eldeki uçları paralel sorar ve cevabı tek biçimde toplar.
 *
 * İki yol var ve ikisi de **personelin izniyle** süzülür — izni olmayan uç
 * hiç istenmez, cevaba da girmez. Bu bir görsel süzgeç değil: backend zaten
 * 403 dönerdi, ama 403'ü "yok" diye okumak `§2d2`'nin yasakladığı var/yok
 * sızıntısını panelde yeniden üretirdi. Sormamak, en temiz cevaptır.
 *
 *  - **UUID:** yedi nesne ucu paralel denenir, ilk 200 dönen kazanır. 404
 *    olağan bir cevaptır burada — altı uç hep 404 döner — ve `koalaApi`
 *    kuralı gereği her biri bir `[koala-api]` günlük satırı bırakır. O
 *    satırlar bir arıza değil, aramanın kendisidir.
 *  - **Metin:** dört liste ucu `query` ile paralel istenir, her biri ilk
 *    {@link GLOBAL_SEARCH_GROUP_SIZE}. Şirket ucu `status` ister ve
 *    varsayılanı PENDING; ada göre arayan operatör onaylı şirketi de bulmalı,
 *    bu yüzden üç durum ayrı ayrı sorulup birleştirilir.
 *
 * E-posta yalnız `user.read_pii` taşıyan aktöre yazılır. Liste DTO'larının
 * çoğu zaten `SafeUserDto`; tek istisna ilan satırındaki `employer`
 * (`StaffPartyDto`, e-postalı) ve o alan da aynı kapının arkasında kalır.
 */

export interface GlobalSearchInput {
  readonly accessToken: string;
  readonly has: (permission: Permission) => boolean;
  /** Operatörün yazdığı ham metin; kırpma ve 2–100 kuralı burada uygulanır. */
  readonly query: string;
}

interface ObjectTarget {
  readonly kind: SearchObjectKind;
  readonly permission: Permission;
  readonly path: (id: string) => string;
  readonly href: (id: string) => string;
}

/** Issue'daki sıra; yarışın kazananı sıraya değil cevabın hızına bağlıdır. */
export const OBJECT_TARGETS: readonly ObjectTarget[] = [
  { kind: "user", permission: "user.read", path: marketplaceUserPath, href: userHref },
  { kind: "assignment", permission: "payment.read", path: escrowSummaryPath, href: assignmentHref },
  { kind: "payment", permission: "payment.read", path: paymentPath, href: paymentHref },
  { kind: "payout", permission: "payout.reconcile", path: payoutPath, href: payoutHref },
  { kind: "dispute", permission: "dispute.resolve", path: disputeDetailPath, href: disputeHref },
  { kind: "job", permission: "job.read", path: jobPath, href: jobHref },
  { kind: "company", permission: "company.approve", path: companyDetailPath, href: companyHref },
];

export const GROUP_PERMISSIONS: Record<SearchGroupKind, Permission> = {
  user: "user.read",
  job: "job.read",
  company: "company.approve",
  assignment: "payment.read",
};

/**
 * Varlık yoklaması için yeter: `id` dışındaki her alan atılır, böylece bir
 * DTO değişikliği "bulundu"yu "bulunamadı"ya çeviremez. Nesne sayfası kendi
 * tam şemasıyla yeniden okur.
 */
const existsSchema = z.object({ id: z.string() });

export async function globalSearch(input: GlobalSearchInput): Promise<GlobalSearchResponse> {
  const trimmed = input.query.trim();
  if (isUuid(trimmed)) {
    return lookupObject(input, trimmed.toLowerCase());
  }

  const query = searchQueryParam(trimmed);
  if (query === undefined) {
    return { kind: "idle" };
  }

  return searchText(input, query);
}

/* -------------------------------------------------------------------------- */
/* UUID yolu                                                                  */
/* -------------------------------------------------------------------------- */

class ProbeMiss extends Error {
  constructor(readonly outcome: "not-found" | "unavailable" | "rate-limited") {
    super(outcome);
  }
}

async function lookupObject(input: GlobalSearchInput, id: string): Promise<GlobalSearchResponse> {
  const targets = OBJECT_TARGETS.filter((target) => input.has(target.permission));
  if (targets.length === 0) {
    return { kind: "no-permission" };
  }

  const probes = targets.map(async (target) => {
    try {
      await koalaApi.get({
        path: target.path(id),
        schema: existsSchema,
        accessToken: input.accessToken,
        cache: "no-store",
      });
      return target;
    } catch (error) {
      throw new ProbeMiss(classifyMiss(error));
    }
  });

  try {
    /**
     * `Promise.any`: ilk **başarılı** cevap kazanır, kalan istekler
     * sonuçlanmaya bırakılır. Bir kimlik iki tabloda birden bulunmaz; iki
     * 200 gelse bile ilkini açmak yanlış bir yere götürmez.
     */
    const winner = await Promise.any(probes);
    return { kind: "object", objectKind: winner.kind, href: winner.href(id) };
  } catch (aggregate) {
    const misses = (aggregate as AggregateError).errors.filter(
      (error): error is ProbeMiss => error instanceof ProbeMiss,
    );
    const limited = misses.find((miss) => miss.outcome === "rate-limited");
    if (limited !== undefined) {
      return { kind: "rate-limited", retryAfterMs: GLOBAL_SEARCH_DEFAULT_COOLDOWN_MS };
    }
    /**
     * Her uç 404 dediyse kimlik yok. Ama bir uç 5xx/ağ hatasıyla düştüyse
     * "bulunamadı" demek yalan olur — kayıt tam o uçta olabilir.
     */
    if (misses.some((miss) => miss.outcome === "unavailable")) {
      return { kind: "unavailable" };
    }
    return { kind: "not-found", probed: targets.map((target) => target.kind) };
  }
}

function classifyMiss(error: unknown): ProbeMiss["outcome"] {
  if (!isKoalaApiError(error)) return "unavailable";
  if (error.status === 429) return "rate-limited";
  /**
   * 404 ve 403 birlikte "yok" sayılır: 403, izin listesi backend'inkinden
   * eskiyse gelir (`/admin/me` her istekte okunsa da yarış olabilir) ve
   * operatöre "bulunamadı"dan fazlasını söylemek var/yok sızdırırdı.
   */
  if (error.status === 404 || error.status === 403) return "not-found";
  return "unavailable";
}

/* -------------------------------------------------------------------------- */
/* Metin yolu                                                                 */
/* -------------------------------------------------------------------------- */

interface GroupOutcome {
  readonly kind: SearchGroupKind;
  readonly result:
    | { readonly ok: true; readonly group: SearchGroup }
    | { readonly ok: false; readonly failure: SearchGroupFailure; readonly error: unknown };
}

async function searchText(input: GlobalSearchInput, query: string): Promise<GlobalSearchResponse> {
  const showPii = input.has("user.read_pii");
  const loaders: Partial<Record<SearchGroupKind, () => Promise<SearchGroup>>> = {
    user: () => loadUsers(input.accessToken, query),
    job: () => loadJobs(input.accessToken, query, showPii),
    company: () => loadCompanies(input.accessToken, query),
    assignment: () => loadAssignments(input.accessToken, query),
  };

  const wanted = (Object.keys(GROUP_PERMISSIONS) as SearchGroupKind[]).filter((kind) =>
    input.has(GROUP_PERMISSIONS[kind]),
  );
  if (wanted.length === 0) {
    return { kind: "no-permission" };
  }

  const outcomes = await Promise.all(
    wanted.map(async (kind): Promise<GroupOutcome> => {
      const load = loaders[kind];
      /* v8 ignore next -- her grup için bir yükleyici var; tip bunu bilmiyor. */
      if (load === undefined) throw new Error(`Yükleyici yok: ${kind}`);
      try {
        return { kind, result: { ok: true, group: await load() } };
      } catch (error) {
        return {
          kind,
          result: {
            ok: false,
            failure: { kind, reason: isSearchQueryTooLong(error) ? "too-long" : "upstream" },
            error,
          },
        };
      }
    }),
  );

  const limited = outcomes.find(
    (outcome) =>
      !outcome.result.ok &&
      isKoalaApiError(outcome.result.error) &&
      outcome.result.error.status === 429,
  );
  if (limited !== undefined && !limited.result.ok) {
    return { kind: "rate-limited", retryAfterMs: GLOBAL_SEARCH_DEFAULT_COOLDOWN_MS };
  }

  const groups: SearchGroup[] = [];
  const failures: SearchGroupFailure[] = [];
  for (const outcome of outcomes) {
    if (outcome.result.ok) groups.push(outcome.result.group);
    else failures.push(outcome.result.failure);
  }

  if (groups.length === 0) {
    return { kind: "unavailable" };
  }

  return { kind: "groups", query, groups, failures };
}

const FIRST_PAGE = { page: 0, size: GLOBAL_SEARCH_GROUP_SIZE } as const;

async function loadUsers(accessToken: string, query: string): Promise<SearchGroup> {
  const page = await getMarketplaceUsers(accessToken, {
    query,
    paging: { ...FIRST_PAGE, sort: USER_PAGING.defaultSort },
  });
  return {
    kind: "user",
    total: page.totalElements,
    hits: page.content.map(userHit),
  };
}

function userHit(user: MarketplaceUser): SearchHit {
  const name = safeUserName(user);
  return {
    id: user.id,
    href: userHref(user.id),
    title: name,
    subtitle: user.username !== null && user.username !== name ? `@${user.username}` : null,
  };
}

async function loadJobs(
  accessToken: string,
  query: string,
  showPii: boolean,
): Promise<SearchGroup> {
  const page = await getAdminJobs(accessToken, {
    query,
    paging: { ...FIRST_PAGE, sort: JOB_PAGING.defaultSort },
  });
  return {
    kind: "job",
    total: page.totalElements,
    hits: page.content.map((job) => jobHit(job, showPii)),
  };
}

function jobHit(job: AdminJob, showPii: boolean): SearchHit {
  /**
   * `employer` bir `StaffPartyDto`: e-posta taşır. `staffPartyName` adı yoksa
   * e-postaya düşer; `user.read_pii` yokken o düşüş kapatılır ki bir ilan
   * satırı e-postayı arka kapıdan yazmasın.
   */
  const employer =
    job.employer === null
      ? null
      : showPii
        ? staffPartyName(job.employer)
        : staffPartyName({ ...job.employer, email: null });
  const owner = job.companyName ?? employer;
  const place = [job.cityName, job.districtName].filter(Boolean).join(" / ");
  return {
    id: job.id,
    href: jobHref(job.id),
    title: job.title ?? job.id,
    subtitle: joinParts([JOB_STATUS_LABELS[job.status], owner, place || null]),
  };
}

/**
 * Üç durum ayrı istek: uç `status` ister ve tek değer alır. Sonuçlar
 * durumdan bağımsız birleştirilip ilk {@link GLOBAL_SEARCH_GROUP_SIZE} satır
 * alınır; toplam üçünün toplamıdır.
 */
async function loadCompanies(accessToken: string, query: string): Promise<SearchGroup> {
  const pages = await Promise.all(
    COMPANY_APPROVAL_STATUSES.map((status) =>
      getCompanies(accessToken, {
        status,
        query,
        paging: { ...FIRST_PAGE, sort: { field: "createdAt", direction: "desc" } },
      }),
    ),
  );
  const hits = pages
    .flatMap((page) => page.content)
    .slice(0, GLOBAL_SEARCH_GROUP_SIZE)
    .map(companyHit);
  return {
    kind: "company",
    total: pages.reduce((sum, page) => sum + page.totalElements, 0),
    hits,
  };
}

function companyHit(company: CompanyReview): SearchHit {
  const place = [company.address?.cityName, company.address?.districtName]
    .filter(Boolean)
    .join(" / ");
  return {
    id: company.id,
    href: companyHref(company.id),
    title: company.name ?? company.id,
    subtitle: joinParts([companyApprovalStatusLabel(company.approvalStatus), place || null]),
  };
}

async function loadAssignments(accessToken: string, query: string): Promise<SearchGroup> {
  const page = await getAdminAssignments(accessToken, {
    query,
    paging: { ...FIRST_PAGE, sort: ASSIGNMENT_PAGING.defaultSort },
  });
  return {
    kind: "assignment",
    total: page.totalElements,
    hits: page.content.map(assignmentHit),
  };
}

function assignmentHit(assignment: EscrowSummary): SearchHit {
  return {
    id: assignment.id,
    href: assignmentHref(assignment.id),
    title: assignment.jobTitle ?? assignment.id,
    subtitle: joinParts([
      ASSIGNMENT_STATUS_LABELS[assignment.status],
      safeUserName(assignment.worker),
      assignment.companyName ?? safeUserName(assignment.employer),
    ]),
  };
}

function joinParts(parts: readonly (string | null | undefined)[]): string | null {
  const kept = parts.filter(
    (part): part is string => typeof part === "string" && part.trim().length > 0,
  );
  return kept.length === 0 ? null : kept.join(" · ");
}
