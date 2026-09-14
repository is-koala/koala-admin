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

/**
 * `06.09.2026 01:58:48` — the audit log's timestamp.
 *
 * Seconds are not decoration here. Two `/admin/**` calls a second apart are two
 * different decisions by koala-backend#14's interceptor, and a minute-precision
 * column collapses them into one line that looks like a duplicate. Note also
 * what this function is *not*: there is no relative formatter in this file, and
 * koala-admin#10 asks for that on purpose — "3 dakika önce" is unreadable
 * evidence, and an audit row is evidence before it is a UI element.
 */
export function formatDateTimeSeconds(value: DateInput): string {
  return formatWith(value, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

/**
 * The UTC offset `Europe/Istanbul` was on at a given instant, as `+03:00`.
 *
 * Looked up rather than hardcoded. Turkey has been on permanent UTC+3 since
 * 2016, so today this always answers `+03:00` — but a date filter that silently
 * assumed it would be wrong by an hour the day that changes, and being wrong by
 * an hour is exactly how an audit query quietly excludes the row somebody was
 * looking for.
 */
function istanbulOffset(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: KOALA_TIME_ZONE,
    timeZoneName: "longOffset",
  }).formatToParts(at);

  const name = parts.find((part) => part.type === "timeZoneName")?.value ?? "";
  const offset = name.replace("GMT", "");
  /* v8 ignore next 3 -- `longOffset` always yields GMT±HH:MM for a real zone. */
  return offset.length === 0 ? "+00:00" : offset;
}

/**
 * `2026-09-01` → the instant that day begins (or ends) in `Europe/Istanbul`,
 * as a UTC ISO-8601 string.
 *
 * A date filter typed by a person in Istanbul means an Istanbul day. Sending
 * the bare `2026-09-01` would leave the backend to guess a zone, and the
 * three-hour window that guess gets wrong is three hours of audit rows.
 * Returns `null` for anything that is not a `YYYY-MM-DD` calendar date, so a
 * hand-edited query string cannot push junk onto the wire.
 */
export function istanbulDayBoundary(day: string, edge: "start" | "end"): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) {
    return null;
  }

  const time = edge === "start" ? "00:00:00.000" : "23:59:59.999";
  const utcGuess = new Date(`${day}T${time}Z`);
  if (Number.isNaN(utcGuess.getTime())) {
    return null;
  }

  const local = new Date(`${day}T${time}${istanbulOffset(utcGuess)}`);
  return Number.isNaN(local.getTime()) ? null : local.toISOString();
}

/**
 * `01.09.2026 08:00` — ofsetsiz bir `LocalDateTime` için.
 *
 * İlanın başlangıç ve bitişi (`AdminJobDto.startDateTime`) backend'den
 * `2026-09-01T08:00:00` gibi dilimsiz gelir. Bu bir an değil, üzerinde
 * anlaşılmış duvar saatidir; `new Date(...)` onu sürecin diliminde yorumlar
 * ve UTC'de koşan bir konteynerde üç saat kaydırırdı. Metin olduğu gibi
 * okunur, hiçbir dönüşümden geçmez. Ofset taşıyan ya da tanınmayan bir değer
 * {@link formatDateTime}'a düşer.
 */
export function formatWallClock(value: string | null | undefined): string {
  if (value === null || value === undefined || value === "") {
    return EMPTY_VALUE;
  }

  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?$/.exec(value);
  if (match === null) {
    return formatDateTime(value);
  }

  const [, year, month, day, hour, minute] = match;
  return `${day}.${month}.${year} ${hour}:${minute}`;
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
