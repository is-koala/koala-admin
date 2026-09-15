import "server-only";

import type { Route } from "next";

import { NO_AUDIT_FILTERS, type AuditEntry } from "@/lib/audit-log";
import { listHref, paymentsHref, payoutsHref } from "@/lib/panel-href";
import { SLA_SAMPLE_SIZE, overdueSummary, type OverdueSummary } from "@/lib/queue-sla";
import type { Permission } from "@/server/authz/permissions";

import { DELETION_PAGING, getAccountDeletions } from "./account-deletions";
import { getAuditLog } from "./audit";
import { getCompanies, COMPANY_PAGING } from "./companies";
import { DISPUTE_PAGING, getDisputes } from "./disputes";
import { getFinanceSummary, type FinanceSummary } from "./finance";
import { getPendingIbanVerifications, IBAN_PENDING_PAGING } from "./iban-verification";
import { getIdentityReviews, IDENTITY_REVIEW_PAGING } from "./identity-reviews";
import { getPayments, PAYMENT_PAGING } from "./payments";
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
  /** Sayının neyi kapsadığı, yalnız kuyruk adından anlaşılmıyorsa. */
  readonly description: string | null;
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
 * Ödeme alarmları (koala-admin#111). "Takılı ödemeler" `FinanceSummaryDto`
 * sayacıdır (`finance.read`); o izin yoksa `payment.read` ile VERIFY_PENDING
 * listesinin ilk {@link SLA_SAMPLE_SIZE} satırından `nextVerificationAt`
 * boş olanlar sayılır — kuyruk örneklemden büyükse sayı alt sınırdır
 * (`capped`). "Başarısız ödemeler" FAILED listesinin `totalElements`i.
 * Liste bağlantısı listenin kendi iznine bakar ve izin yoksa `null` kalır —
 * sayı yine görünür, tıklanınca 403'e götürülmez.
 */
export interface OpsAlertTile {
  readonly key: "stuck-payments" | "failed-payments" | "overdue-payouts";
  readonly label: string;
  readonly count: number | null;
  /** Doğruysa sayı "en az bu kadar"dır; karo `+` ile yazar. */
  readonly capped: boolean;
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
function agedHref(href: OpsQueueHref, sort: SortSpec): Route {
  return listHref(href, { sirala: sortParam(sort) });
}

const CREATED_ASC: SortSpec = { field: "createdAt", direction: "asc" };

/**
 * Bugünün işi. İzni olmayan kuyruk hiç istenmez; bir uç düşerse karo durur,
 * sayı uydurulmaz. Finans ve denetim ayrı izinlerdir. Her kuyruk tek istek:
 * ilk {@link SLA_SAMPLE_SIZE} satır eskiden yeniye, hem "en eski" hem eşiği
 * aşan sayı ondan okunur. Yaş hangi alandan ölçülüyorsa örneklem de o alana
 * göre sıralanır: IBAN doğrulamada hesabın `createdAt`i değil doğrulamanın
 * `startedAt`i (backend `verificationStartedAt`), hesap silmede `requestedAt`.
 */
export async function loadOpsHome(
  accessToken: string,
  permissions: readonly Permission[],
): Promise<OpsHome> {
  const now = new Date();
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
        { timestamp: "createdAt", overdueHref: agedHref("/identity-reviews", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("content.moderate")) {
    // Tek status alanı var; UNDER_REVIEW'i istemezsek incelemedeki şikayet
    // evde yok sayılır. İkisini de isteyip toplamak fail-closed: biri düşerse
    // karo hata verir, kısmi toplam "iş yok" gibi durmaz. Eşik sayısı da iki
    // örneklemin toplamı. Liste tek durum aldığından bağlantı OPEN kuyruğunu
    // açar; karo bunu açıklamasında söyler.
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
        {
          timestamp: "createdAt",
          overdueHref: listHref("/reports", { durum: "OPEN", sirala: sortParam(CREATED_ASC) }),
          now,
          description: "Açık + incelemede; bağlantı açık kuyruğu açar.",
        },
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
        { timestamp: "createdAt", overdueHref: agedHref("/companies", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("dispute.resolve")) {
    jobs.push(
      countTile(
        "/disputes",
        "Uyuşmazlıklar",
        () => getDisputes(accessToken, samplePaging(DISPUTE_PAGING, CREATED_ASC)),
        { timestamp: "createdAt", overdueHref: agedHref("/disputes", CREATED_ASC), now },
      ),
    );
  }
  if (held.has("bank.account.verify")) {
    const startedAsc: SortSpec = { field: "verificationStartedAt", direction: "asc" };
    jobs.push(
      countTile(
        "/iban-verifications",
        "IBAN doğrulama",
        () =>
          getPendingIbanVerifications(accessToken, {
            paging: samplePaging(IBAN_PENDING_PAGING, startedAsc),
          }),
        { timestamp: "startedAt", overdueHref: agedHref("/iban-verifications", startedAsc), now },
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
        {
          timestamp: "createdAt",
          overdueHref: agedHref("/payout-reconciliation", CREATED_ASC),
          now,
        },
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
        {
          timestamp: "requestedAt",
          overdueHref: agedHref("/account-deletions", requestedAsc),
          now,
        },
      ),
    );
  }

  const [queues, financeResult, recentAudit, payments] = await Promise.all([
    Promise.all(jobs),
    held.has("finance.read") ? readFinance(accessToken) : Promise.resolve(null),
    held.has("audit.read") ? readRecentAudit(accessToken) : Promise.resolve([]),
    held.has("payment.read")
      ? readPaymentAlerts(accessToken, { stuckFromList: !held.has("finance.read") })
      : Promise.resolve(null),
  ]);

  return {
    queues,
    alerts: alertTiles(financeResult, payments, held),
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

/** Satırın yaşının okunduğu alan; örneklem de aynı alana göre sıralıdır. */
type TimestampField = "createdAt" | "requestedAt" | "startedAt";

interface TileOptions {
  readonly timestamp: TimestampField;
  readonly overdueHref: Route;
  readonly now: Date;
  readonly description?: string;
}

async function countTile(
  href: OpsQueueTile["href"],
  label: string,
  load: () => Promise<{ totalElements: number; content: readonly unknown[] }>,
  options: TileOptions,
): Promise<OpsQueueTile> {
  const description = options.description ?? null;
  try {
    const page = await load();
    const timestamps = page.content.map((row) => rowTimestamp(row, options.timestamp));
    return {
      href,
      label,
      description,
      count: page.totalElements,
      oldestAt: timestamps[0] ?? null,
      overdue: {
        ...overdueSummary(timestamps, page.totalElements, options.now),
        href: options.overdueHref,
      },
      loadError: null,
    };
  } catch {
    // Sayı uydurmak (0 veya "—") operatörü "iş yok" sanır; karo durur, diğerleri devam eder.
    return {
      href,
      label,
      description,
      count: null,
      oldestAt: null,
      overdue: null,
      loadError: `${label} yüklenemedi.`,
    };
  }
}

function rowTimestamp(row: unknown, field: TimestampField): string | null {
  if (row === null || typeof row !== "object") {
    return null;
  }
  const value = (row as Record<TimestampField, unknown>)[field];
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * İki eskiden-yeniye `createdAt` örneklemini tek eskiden-yeniye örnekleme
 * birleştirir. Her ikisi de kendi kuyruğunu tüketmişse (toplam ≤ örneklem)
 * birleşim tamdır; biri örneklemden büyükse birleşimin kuyruğu o kuyruğun
 * görünmeyen satırlarından daha yeni olabilir — o yüzden birleşik örneklem,
 * büyük kuyruğun örnekleminden uzun tutulmaz ki `overdueSummary`'nin
 * "örneklem tükendi" kuralı bozulmasın.
 */
function mergeAscending(
  ...samples: ReadonlyArray<readonly [rows: readonly unknown[], totalElements: number]>
): readonly unknown[] {
  const merged = samples
    .flatMap(([rows]) => rows)
    .map((row) => ({ row, ts: rowTimestamp(row, "createdAt") }))
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

type CountResult = { ok: true; count: number; capped: boolean } | { ok: false };

interface PaymentAlerts {
  readonly failed: CountResult;
  /** Yalnız `finance.read` yokken istenir; varsa özet sayacı kullanılır. */
  readonly stuck: CountResult | null;
}

/**
 * `GET /admin/payments?status=` (koala-backend#301). Başarısız sayısı bir
 * satırlık sayfanın `totalElements`i. Takılı yedek yolu VERIFY_PENDING'in
 * en eski {@link SLA_SAMPLE_SIZE} satırında `nextVerificationAt` boş
 * olanları sayar; kuyruk örneklemden büyükse görünmeyen satırlar arasında da
 * takılı olabilir, sayı alt sınır (`capped`) olur.
 */
async function readPaymentAlerts(
  accessToken: string,
  options: { stuckFromList: boolean },
): Promise<PaymentAlerts> {
  const [failed, stuck] = await Promise.all([
    countResult(async () => {
      const page = await getPayments(accessToken, {
        status: "FAILED",
        paging: { page: 0, size: 1, sort: PAYMENT_PAGING.defaultSort },
      });
      return { count: page.totalElements, capped: false };
    }),
    options.stuckFromList
      ? countResult(async () => {
          const page = await getPayments(accessToken, {
            status: "VERIFY_PENDING",
            paging: samplePaging(PAYMENT_PAGING, CREATED_ASC),
          });
          const stuckRows = page.content.filter((row) => row.nextVerificationAt === null);
          return { count: stuckRows.length, capped: page.totalElements > page.content.length };
        })
      : Promise.resolve(null),
  ]);
  return { failed, stuck };
}

async function countResult(
  load: () => Promise<{ count: number; capped: boolean }>,
): Promise<CountResult> {
  try {
    return { ok: true, ...(await load()) };
  } catch {
    return { ok: false };
  }
}

/**
 * Takılı ödeme, başarısız ödeme ve vadesi geçmiş hakediş (koala-backend#301).
 * Eski sunucu özet sayaçlarını göndermez: o karo çizilmez. Özet düşmüşse
 * ondan gelen karolar "yüklenemedi" der; finans kartları zaten gizlenir.
 * `finance.read` olmayan `payment.read` sahibi takılı sayısını listeden alır.
 */
function alertTiles(
  finance: FinanceResult | null,
  payments: PaymentAlerts | null,
  held: ReadonlySet<Permission>,
): OpsAlertTile[] {
  const stuckHref = held.has("payment.read") ? paymentsHref({ durum: "VERIFY_PENDING" }) : null;
  const stuck: AlertShape = {
    key: "stuck-payments",
    label: "Takılı ödemeler",
    href: stuckHref,
    description: "Doğrulama bekleyen ve zamanlayıcıdan düşmüş tahsilatlar.",
  };
  const failed: AlertShape = {
    key: "failed-payments",
    label: "Başarısız ödemeler",
    href: paymentsHref({ durum: "FAILED" }),
    description: "Sağlayıcıda başarısız olan tahsilat denemeleri.",
  };
  const overdue: AlertShape = {
    key: "overdue-payouts",
    label: "Vadesi geçmiş hakediş",
    href: held.has("payout.reconcile")
      ? payoutsHref({ durum: "PROCESSING", sirala: sortParam(CREATED_ASC) })
      : null,
    description: "Banka mutabakatı eşikten uzun süredir bekleyen hakedişler.",
  };

  const tiles: Array<OpsAlertTile | null> = [];
  if (finance !== null) {
    tiles.push(summaryTile(stuck, finance, (summary) => summary.stuckPaymentCount));
  } else if (payments?.stuck) {
    tiles.push(countedTile(stuck, payments.stuck));
  }
  if (payments !== null) {
    tiles.push(countedTile(failed, payments.failed));
  }
  if (finance !== null) {
    tiles.push(summaryTile(overdue, finance, (summary) => summary.overduePayoutCount));
  }
  return tiles.filter((tile) => tile !== null);
}

type AlertShape = Omit<OpsAlertTile, "count" | "capped" | "loadError">;

/** Özet düştüyse hata karosu; sayaç yoksa (eski sunucu) karo yok. */
function summaryTile(
  tile: AlertShape,
  finance: FinanceResult,
  read: (summary: FinanceSummary) => number | null,
): OpsAlertTile | null {
  if (!finance.ok) return failedTile(tile);
  const count = read(finance.summary);
  return count === null ? null : { ...tile, count, capped: false, loadError: null };
}

function failedTile(tile: AlertShape): OpsAlertTile {
  return { ...tile, count: null, capped: false, loadError: `${tile.label} yüklenemedi.` };
}

function countedTile(tile: AlertShape, result: CountResult): OpsAlertTile {
  return result.ok
    ? { ...tile, count: result.count, capped: result.capped, loadError: null }
    : failedTile(tile);
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
