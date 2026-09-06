import { describe, expect, it } from "vitest";

import {
  EMPTY_VALUE,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatInteger,
  formatLongDate,
  formatNumber,
  formatPercent,
  formatTime,
} from "./format";

/** A real `timeStamp` from the backend: an instant in UTC. */
const UTC_INSTANT = "2026-09-05T22:58:48.643136333Z";

describe("date formatting", () => {
  it("renders a UTC instant in Europe/Istanbul, not in the runner's zone", () => {
    // 22:58 UTC is 01:58 the next day in Istanbul (UTC+3). If this ever reads
    // 22:58 or 23:58, the time zone is leaking from the host and every payout
    // timestamp in the panel is wrong.
    expect(formatDateTime(UTC_INSTANT)).toBe("06.09.2026 01:58");
    expect(formatDate(UTC_INSTANT)).toBe("06.09.2026");
    expect(formatTime(UTC_INSTANT)).toBe("01:58:48");
  });

  it("uses Turkish month and weekday names", () => {
    expect(formatLongDate(UTC_INSTANT)).toBe("6 Eylül 2026 Pazar");
  });

  it("accepts a Date and a millisecond timestamp", () => {
    const date = new Date(UTC_INSTANT);
    expect(formatDate(date)).toBe("06.09.2026");
    expect(formatDate(date.getTime())).toBe("06.09.2026");
  });

  it("returns a placeholder rather than 'Invalid Date'", () => {
    expect(formatDate(null)).toBe(EMPTY_VALUE);
    expect(formatDate(undefined)).toBe(EMPTY_VALUE);
    expect(formatDate("")).toBe(EMPTY_VALUE);
    expect(formatDateTime("yarın")).toBe(EMPTY_VALUE);
  });
});

describe("number formatting", () => {
  it("uses the Turkish separators", () => {
    expect(formatNumber(1234.567)).toBe("1.234,567");
    expect(formatInteger(1234.567)).toBe("1.235");
  });

  it("formats lira", () => {
    expect(formatCurrency(1234.5)).toBe("₺1.234,50");
  });

  it("takes a ratio for percentages", () => {
    expect(formatPercent(0.125)).toBe("%12,5");
  });

  it("returns a placeholder for anything unusable", () => {
    expect(formatNumber(null)).toBe(EMPTY_VALUE);
    expect(formatNumber("çok")).toBe(EMPTY_VALUE);
    expect(formatNumber(Number.POSITIVE_INFINITY)).toBe(EMPTY_VALUE);
  });
});
