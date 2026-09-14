import { describe, expect, it } from "vitest";

import {
  dateRangeQuery,
  dateRangeState,
  describeDateRange,
  hasDateRange,
  isCalendarDay,
  readDateRange,
} from "./date-range";

/**
 * `?baslangic=&bitis=` → backend `from`/`to` (koala-admin#110). Backend
 * dilimsiz değeri 400'ler ve iki sınırı dahil sayar (koala-backend#301);
 * panelin ürettiği an her zaman `Z` ile biter ve bitiş günün son
 * milisaniyesidir.
 */
describe("readDateRange", () => {
  it("reads two calendar days and drops anything that is not one", () => {
    expect(readDateRange({ baslangic: "2026-09-01", bitis: "2026-09-14" })).toEqual({
      fromDay: "2026-09-01",
      toDay: "2026-09-14",
    });
    expect(readDateRange({ baslangic: "dün", bitis: "2026-02-30" })).toEqual({
      fromDay: null,
      toDay: null,
    });
    expect(readDateRange({ baslangic: ["2026-09-01", "2026-09-02"] })).toEqual({
      fromDay: "2026-09-01",
      toDay: null,
    });
    expect(readDateRange({})).toEqual({ fromDay: null, toDay: null });
  });

  it("knows a formatted string that is not a day", () => {
    expect(isCalendarDay("2026-09-14")).toBe(true);
    expect(isCalendarDay("2026-02-29")).toBe(false);
    expect(isCalendarDay("2026-13-01")).toBe(false);
    expect(isCalendarDay("14.09.2026")).toBe(false);
  });
});

describe("dateRangeQuery", () => {
  it("sends the Istanbul start of day and the last millisecond of the end day, in UTC", () => {
    expect(dateRangeQuery({ fromDay: "2026-09-01", toDay: "2026-09-14" })).toEqual({
      from: "2026-08-31T21:00:00.000Z",
      to: "2026-09-14T20:59:59.999Z",
    });
  });

  it("leaves an empty side undefined so the parameter is not written at all", () => {
    expect(dateRangeQuery({ fromDay: null, toDay: "2026-01-31" })).toEqual({
      from: undefined,
      to: "2026-01-31T20:59:59.999Z",
    });
    expect(dateRangeQuery({ fromDay: null, toDay: null })).toEqual({
      from: undefined,
      to: undefined,
    });
  });
});

describe("view state and wording", () => {
  it("writes only the present sides back into the address", () => {
    expect(dateRangeState({ fromDay: "2026-09-01", toDay: null })).toEqual({
      baslangic: "2026-09-01",
    });
    expect(hasDateRange({ fromDay: null, toDay: null })).toBe(false);
    expect(hasDateRange({ fromDay: null, toDay: "2026-09-01" })).toBe(true);
  });

  it("describes the range in Turkish day order", () => {
    expect(describeDateRange({ fromDay: "2026-09-01", toDay: "2026-09-14" })).toBe(
      "01.09.2026 – 14.09.2026",
    );
    expect(describeDateRange({ fromDay: "2026-09-01", toDay: null })).toBe(
      "01.09.2026'dan itibaren",
    );
    expect(describeDateRange({ fromDay: null, toDay: "2026-09-14" })).toBe("14.09.2026'ya kadar");
  });
});
