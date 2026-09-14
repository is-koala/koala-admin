import "server-only";

import type { Route } from "next";

import { NO_AUDIT_FILTERS, type AuditEntry } from "@/lib/audit-log";
import { listHref, paymentsHref, payoutsHref } from "@/lib/panel-href";
import { SLA_SAMPLE_SIZE, overdueSummary, type OverdueSummary } from "@/lib/queue-sla";
import type { Permission } from "@/server/authz/permissions";

import { DELETION_PAGING, getAccountDeletions } from "./account-deletions";
import { getAuditLog } from "./audit";
import { getCompanies, COMPANY_PAGING } from "./companies";
import { getDisputes } from "./disputes";
import { getFinanceSummary, type FinanceSummary } from "./finance";
import { getPendingIbanVerifications, IBAN_PENDING_PAGING } from "./iban-verification";
import { getIdentityReviews, IDENTITY_REVIEW_PAGING } from "./identity-reviews";
import { getPayouts, PAYOUT_PAGING } from "./payout-reconciliation";
import { getReports, REPORT_PAGING } from "./reports";
import { sortParam, type Paging, type PagingContract, type SortSpec } from "./paging";

export type OpsQueueHref =
  | "/identity-reviews"
  | "/reports"
  | "/companies"
  | "/disputes"
  | "/iban-verifications"
  | "/payout-reconciliation"
  | "/account-deletions";

export interface OpsQueueTile {
  readonly href: OpsQueueHref;
  readonly label: string;
  readonly count: number | null;
  readonly oldestAt: string | null;
  /**
   * SLA eşiğini (koala-admin#111) aşan kayıtlar ve yaşa göre sıralı listenin
   * adresi. `null` yalnız karo yüklenemediğinde; boş kuyruk `count: 0` taşır.
   */
  readonly overdue: (OverdueSummary & { readonly href: Route }) | null;
  /** Doluysa sayı yoktur; boş kuyruk `count: 0` ile gelir, hata uydurulmaz. */
  readonly loadError: string | null;
}

/**
 * Finans özetinden türeyen alarm karoları (koala-admin#111): sayı kuyruk
 * değil `FinanceSummaryDto` sayacıdır, o yüzden `finance.read` ister; liste
 * bağlantısı listenin kendi iznine bakar ve izin yoksa `null` kalır — sayı
 * yine görünür, tıklanınca 403'e götürülmez.
 */
export interface OpsAlertTile {
  readonly key: "stuck-payments" | "overdue-payouts";
  readonly label: string;
  readonly count: number | null;
  readonly href: Route | null;
  readonly description: string;
  readonly loadError: string | null;
}

export interface OpsHome {
  readonly queues: readonly OpsQueueTile[];
  readonly alerts: readonly OpsAlertTile[];
  readonly finance: FinanceSummary | null;
  readonly recentAudit: readonly AuditEntry[];
}

/** Yaşa göre sıralı liste: `sirala` panelin URL sözlüğü, alan ucun kendi sıralanabiliri. */
function agedHref(href: OpsQueueHref, sort: SortSpec, state: Record<string, string> = {}): Route {
  return listHref(href, { ...state, sirala: sortParam(sort) });
}

const CREATED_ASC: SortSpec = { field: "createdAt", direction: "asc" };

/**
 * Bugünün işi. İzni olmayan kuyruk hiç istenmez; bir uç düşerse karo durur,
 * sayı uydurulmaz. Finans ve denetim ayrı izinlerdir. Her kuyruk tek istek:
 * ilk {@link SLA_SAMPLE_SIZE} satır eskiden yeniye, hem "en eski" hem eşiği
 * aşan sayı ondan okunur. Uyuşmazlık ucu panelden sıralanmaz; yeniden
 * eskiye gelir ve sayı yine kesindir (`overdueSummary` `desc`), "en eski"
 * yalnız kuyruk örnekleme sığdığında bilinir.
 */
export async function loadOpsHome(
  accessToken: string,
  permissions: readonly Permission[],
  now: Date = new Date(),
): Promise<OpsHome> {
  const held = new Set<Permission>(permissions);
  const jobs: Array<Promise<OpsQueueTile>> = [];

  if (held.has("identity.review")) {
    jobs.push(
      countTile(
        "/identity-reviews",
        "Kimlik incelemeleri",
        () =>
          getIdentityReviews(accessToken, {
            status: "PENDING",
            paging: samplePaging(IDENTITY_REVIEW_PAGING, CREATED_ASC),
          }),
        { order: "asc", overdueHref: agedHref("/identity-reviews", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("content.moderate")) {
    // Tek status alanı var; UNDER_REVIEW'i istemezsek incelemedeki şikayet
    // evde yok sayılır. İkisini de isteyip toplamak fail-closed: biri düşerse
    // karo hata verir, kısmi toplam "iş yok" gibi durmaz. Eşik sayısı da iki
    // örneklemin toplamı; bağlantı OPEN kuyruğunu açar (liste tek durum alır).
    jobs.push(
      countTile(
        "/reports",
        "Şikayetler",
        async () => {
          const paging = samplePaging(REPORT_PAGING, CREATED_ASC);
          const [open, inReview] = await Promise.all([
            getReports(accessToken, { status: "OPEN", paging }),
            getReports(accessToken, { status: "UNDER_REVIEW", paging }),
          ]);
          return {
            totalElements: open.totalElements + inReview.totalElements,
            content: mergeAscending(
              [open.content, open.totalElements],
              [inReview.content, inReview.totalElements],
            ),
          };
        },
        { order: "asc", overdueHref: agedHref("/reports", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("company.approve")) {
    jobs.push(
      countTile(
        "/companies",
        "Şirket onayları",
        () =>
          getCompanies(accessToken, {
            status: "PENDING",
            query: null,
            paging: samplePaging(COMPANY_PAGING, CREATED_ASC),
          }),
        { order: "asc", overdueHref: agedHref("/companies", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("dispute.resolve")) {
    jobs.push(
      countTile(
        "/disputes",
        "Uyuşmazlıklar",
        async () => getDisputes(accessToken, { page: 0, size: SLA_SAMPLE_SIZE }),
        { order: "desc", overdueHref: agedHref("/disputes", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("bank.account.verify")) {
    jobs.push(
      countTile(
        "/iban-verifications",
        "IBAN doğrulama",
        () =>
          getPendingIbanVerifications(accessToken, {
            paging: samplePaging(IBAN_PENDING_PAGING, CREATED_ASC),
          }),
        { order: "asc", overdueHref: agedHref("/iban-verifications", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("payout.reconcile")) {
    // Status gönderilmezse backend PROCESSING'e düşer; ev karosu niyeti
    // açık tutmak için PROCESSING'i açık ister — escrow çıkışı (PENDING) karışmasın.
    jobs.push(
      countTile(
        "/payout-reconciliation",
        "Hakediş mutabakatı",
        () =>
          getPayouts(accessToken, {
            status: "PROCESSING",
            paging: samplePaging(PAYOUT_PAGING, CREATED_ASC),
          }),
        { order: "asc", overdueHref: agedHref("/payout-reconciliation", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("user.read_pii")) {
    const requestedAsc: SortSpec = { field: "requestedAt", direction: "asc" };
    jobs.push(
      countTile(
        "/account-deletions",
        "Hesap silme",
        () =>
          getAccountDeletions(accessToken, {
            status: "REQUESTED",
            paging: samplePaging(DELETION_PAGING, requestedAsc),
          }),
        { order: "asc", overdueHref: agedHref("/account-deletions", requestedAsc), now },
      ),
    );
  }

  const [queues, financeResult, recentAudit] = await Promise.all([
    Promise.all(jobs),
    held.has("finance.read") ? readFinance(accessToken) : Promise.resolve(null),
    held.has("audit.read") ? readRecentAudit(accessToken) : Promise.resolve([]),
  ]);

  return {
    queues,
    alerts: financeResult === null ? [] : alertTiles(financeResult, held),
    finance: financeResult?.ok === true ? financeResult.summary : null,
    recentAudit,
  };
}

export async function loadOpsSnapshot(
  accessToken: string,
  permissions: readonly Permission[],
): Promise<readonly OpsQueueTile[]> {
  return (await loadOpsHome(accessToken, permissions)).queues;
}

function samplePaging(contract: PagingContract, sort: SortSpec): Paging {
  // Sıralanabilir olmayan alan istemek 400'dür; sözleşme tanımıyorsa varsayılan.
  const usable = contract.sortable.includes(sort.field) ? sort : contract.defaultSort;
  return { page: 0, size: SLA_SAMPLE_SIZE, sort: usable };
}

interface TileOptions {
  readonly order: "asc" | "desc";
  readonly overdueHref: Route;
  readonly now: Date;
}

async function countTile(
  href: OpsQueueTile["href"],
  label: string,
  load: () => Promise<{ totalElements: number; content: readonly unknown[] }>,
  options: TileOptions,
): Promise<OpsQueueTile> {
  try {
    const page = await load();
    const timestamps = page.content.map(rowTimestamp);
    const oldestAt =
      options.order === "asc"
        ? (timestamps[0] ?? null)
        : page.totalElements <= timestamps.length
          ? (timestamps.at(-1) ?? null)
          : null;
    return {
      href,
      label,
      count: page.totalElements,
      oldestAt,
      overdue: {
        ...overdueSummary(timestamps, page.totalElements, options.order, options.now),
        href: options.overdueHref,
      },
      loadError: null,
    };
  } catch {
    // Sayı uydurmak (0 veya "—") operatörü "iş yok" sanır; karo durur, diğerleri devam eder.
    return {
      href,
      label,
      count: null,
      oldestAt: null,
      overdue: null,
      loadError: `${label} yüklenemedi.`,
    };
  }
}

function rowTimestamp(row: unknown): string | null {
  if (row === null || typeof row !== "object") {
    return null;
  }
  const record = row as { createdAt?: unknown; requestedAt?: unknown; startedAt?: unknown };
  const value = record.createdAt ?? record.requestedAt ?? record.startedAt;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * İki eskiden-yeniye örneklemi tek eskiden-yeniye örnekleme birleştirir.
 * Her ikisi de kendi kuyruğunu tüketmişse (toplam ≤ örneklem) birleşim
 * tamdır; biri örneklemden büyükse birleşimin kuyruğu o kuyruğun görünmeyen
 * satırlarından daha yeni olabilir — o yüzden birleşik örneklem, büyük
 * kuyruğun örnekleminden uzun tutulmaz ki `overdueSummary`'nin "örneklem
 * tükendi" kuralı bozulmasın.
 */
function mergeAscending(
  ...samples: ReadonlyArray<readonly [rows: readonly unknown[], totalElements: number]>
): readonly unknown[] {
  const merged = samples
    .flatMap(([rows]) => rows)
    .map((row) => ({ row, ts: rowTimestamp(row) }))
    .sort((a, b) => (a.ts ?? "").localeCompare(b.ts ?? ""));
  const shortest = Math.min(
    ...samples.map(([rows, total]) => (total > rows.length ? rows.length : Infinity)),
  );
  return merged.slice(0, Number.isFinite(shortest) ? shortest : merged.length).map((e) => e.row);
}

type FinanceResult = { ok: true; summary: FinanceSummary } | { ok: false };

async function readFinance(accessToken: string): Promise<FinanceResult> {
  try {
    return { ok: true, summary: await getFinanceSummary(accessToken, {}) };
  } catch {
    return { ok: false };
  }
}

/**
 * Takılı ödeme ve vadesi geçmiş hakediş (koala-backend#301). Eski sunucu
 * sayaçları göndermez: karo çizilmez. Özet düşmüşse iki karo da "yüklenemedi"
 * der; finans kartları zaten gizlenir.
 */
function alertTiles(finance: FinanceResult, held: ReadonlySet<Permission>): OpsAlertTile[] {
  const stuckHref = held.has("payment.read") ? paymentsHref({ durum: "VERIFY_PENDING" }) : null;
  const overdueHref = held.has("payout.reconcile")
    ? payoutsHref({ durum: "PROCESSING", sirala: sortParam(CREATED_ASC) })
    : null;
  const stuck: Omit<OpsAlertTile, "count" | "loadError"> = {
    key: "stuck-payments",
    label: "Takılı ödemeler",
    href: stuckHref,
    description: "Doğrulama bekleyen ve zamanlayıcıdan düşmüş tahsilatlar.",
  };
  const overdue: Omit<OpsAlertTile, "count" | "loadError"> = {
    key: "overdue-payouts",
    label: "Vadesi geçmiş hakediş",
    href: overdueHref,
    description: "Banka mutabakatı eşikten uzun süredir bekleyen hakedişler.",
  };

  if (!finance.ok) {
    return [
      { ...stuck, count: null, loadError: `${stuck.label} yüklenemedi.` },
      { ...overdue, count: null, loadError: `${overdue.label} yüklenemedi.` },
    ];
  }
  const tiles: OpsAlertTile[] = [];
  if (finance.summary.stuckPaymentCount !== null) {
    tiles.push({ ...stuck, count: finance.summary.stuckPaymentCount, loadError: null });
  }
  if (finance.summary.overduePayoutCount !== null) {
    tiles.push({ ...overdue, count: finance.summary.overduePayoutCount, loadError: null });
  }
  return tiles;
}

async function readRecentAudit(accessToken: string): Promise<readonly AuditEntry[]> {
  try {
    const page = await getAuditLog(accessToken, {
      filters: NO_AUDIT_FILTERS,
      page: 0,
      size: 8,
    });
    return page.content;
  } catch {
    return [];
  }
}
