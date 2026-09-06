/**
 * The one place dates and numbers are turned into text.
 *
 * Two constants decide everything, and they are not parameters: the panel is
 * operated from Turkey against a backend that stores instants in UTC. If a
 * screen formats a date any other way, an operator reading a payout timestamp
 * gets an hour that does not match the backend log — so every screen goes
 * through here, and nothing calls `toLocaleString` directly.
 */

export const KOALA_LOCALE = "tr-TR";
export const KOALA_TIME_ZONE = "Europe/Istanbul";

/** Rendered in place of a missing or unparseable value. */
export const EMPTY_VALUE = "—";

export type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatWith(value: DateInput, options: Intl.DateTimeFormatOptions): string {
  const date = toDate(value);
  if (date === null) {
    return EMPTY_VALUE;
  }

  return new Intl.DateTimeFormat(KOALA_LOCALE, {
    timeZone: KOALA_TIME_ZONE,
    ...options,
  }).format(date);
}

/** `06.09.2026` */
export function formatDate(value: DateInput): string {
  return formatWith(value, { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** `06.09.2026 01:58` */
export function formatDateTime(value: DateInput): string {
  return formatWith(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** `01:58:48` */
export function formatTime(value: DateInput): string {
  return formatWith(value, {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/** `6 Eylül 2026 Pazar` — for headings, not tables. */
export function formatLongDate(value: DateInput): string {
  return formatWith(value, {
    day: "numeric",
    month: "long",
    year: "numeric",
    weekday: "long",
  });
}

export type NumberInput = number | string | null | undefined;

function toNumber(value: NumberInput): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** `1.234,57` */
export function formatNumber(value: NumberInput, options?: Intl.NumberFormatOptions): string {
  const parsed = toNumber(value);
  if (parsed === null) {
    return EMPTY_VALUE;
  }

  return new Intl.NumberFormat(KOALA_LOCALE, options).format(parsed);
}

/** `1.235` */
export function formatInteger(value: NumberInput): string {
  return formatNumber(value, { maximumFractionDigits: 0 });
}

/** `₺1.234,57` */
export function formatCurrency(value: NumberInput, currency = "TRY"): string {
  return formatNumber(value, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/** `%12,5` — takes a ratio (`0.125`), not a percentage. */
export function formatPercent(value: NumberInput, fractionDigits = 1): string {
  return formatNumber(value, {
    style: "percent",
    minimumFractionDigits: 0,
    maximumFractionDigits: fractionDigits,
  });
}
