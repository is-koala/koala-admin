import { istanbulDayBoundary } from "@/lib/format";
import { readParam, type SearchParams } from "@/server/api/paging";

/**
 * Panel URL → `GET /admin/finance/summary` query.
 *
 * Backend `from` dahildir, `to` hariç Instant. Takvim günü Istanbul günüdür;
 * tek taraf ya da `from >= to` 400 `ADMIN_FINANCE_PERIOD_INVALID` üretir, o
 * yüzden panel onları hiç göndermez.
 */

export const DEFAULT_CURRENCY = "TRY";

export type FinancePeriod =
  | { readonly kind: "all" }
  | { readonly kind: "range"; readonly from: string; readonly to: string }
  | { readonly kind: "invalid"; readonly message: string };

export interface FinanceFilters {
  readonly fromDay: string | null;
  readonly toDay: string | null;
  readonly currency: string;
}

export interface FinanceRequest {
  readonly filters: FinanceFilters;
  readonly period: FinancePeriod;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CURRENCY = /^[A-Z]{3}$/;

function nextCalendarDay(day: string): string | null {
  if (!DAY.test(day)) return null;
  const [year, month, date] = day.split("-").map(Number);
  const next = new Date(Date.UTC(year ?? 0, (month ?? 1) - 1, (date ?? 1) + 1));
  if (Number.isNaN(next.getTime())) return null;
  const yyyy = String(next.getUTCFullYear());
  const mm = String(next.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(next.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function parseDay(value: string | null): string | null {
  return value !== null && DAY.test(value) ? value : null;
}

function parseCurrency(value: string | null): string {
  if (value === null || value === "") return DEFAULT_CURRENCY;
  return CURRENCY.test(value) ? value : DEFAULT_CURRENCY;
}

export function parseFinanceRequest(params: SearchParams = {}): FinanceRequest {
  const fromDay = parseDay(readParam(params, "from"));
  const toDay = parseDay(readParam(params, "to"));
  const currency = parseCurrency(readParam(params, "para"));

  return {
    filters: { fromDay, toDay, currency },
    period: resolvePeriod(fromDay, toDay),
  };
}

function resolvePeriod(fromDay: string | null, toDay: string | null): FinancePeriod {
  if (fromDay === null && toDay === null) {
    return { kind: "all" };
  }
  if (fromDay === null || toDay === null) {
    return {
      kind: "invalid",
      message: "Dönem için başlangıç ve bitiş gününü birlikte seçin.",
    };
  }
  if (fromDay > toDay) {
    return {
      kind: "invalid",
      message: "Bitiş, başlangıçtan sonra olmalı.",
    };
  }

  const from = istanbulDayBoundary(fromDay, "start");
  const nextDay = nextCalendarDay(toDay);
  const to = nextDay === null ? null : istanbulDayBoundary(nextDay, "start");
  if (from === null || to === null) {
    return {
      kind: "invalid",
      message: "Dönem için geçerli bir takvim günü girin.",
    };
  }

  return { kind: "range", from, to };
}

/** Wire query. `null` değerler `buildKoalaUrl` tarafından düşer. */
export function financeSummaryQuery(request: FinanceRequest): Record<string, string | null> | null {
  if (request.period.kind === "invalid") return null;

  const currency = request.filters.currency === DEFAULT_CURRENCY ? null : request.filters.currency;

  if (request.period.kind === "all") {
    return { from: null, to: null, currency };
  }

  return { from: request.period.from, to: request.period.to, currency };
}
