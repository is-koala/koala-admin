import { describe, expect, it } from "vitest";

import { financeSummaryQuery, parseFinanceRequest } from "./finance-summary";

describe("parseFinanceRequest", () => {
  it("omits the period when both days are empty — all history through now", () => {
    const request = parseFinanceRequest({});

    expect(request.period).toEqual({ kind: "all" });
    expect(request.filters.currency).toBe("TRY");
    expect(financeSummaryQuery(request)).toEqual({ from: null, to: null, currency: null });
  });

  it("refuses a single bound so the panel never sends a 400 period", () => {
    const request = parseFinanceRequest({ from: "2026-03-01" });

    expect(request.period.kind).toBe("invalid");
    expect(financeSummaryQuery(request)).toBeNull();
  });

  it("refuses from >= to instead of asking the backend", () => {
    expect(parseFinanceRequest({ from: "2026-04-01", to: "2026-03-01" }).period.kind).toBe(
      "invalid",
    );
    // Aynı takvim günü Instant olarak [00:00, ertesi 00:00) — backend from >= to değil.
    expect(
      financeSummaryQuery(parseFinanceRequest({ from: "2026-03-15", to: "2026-03-15" })),
    ).toEqual({
      from: "2026-03-14T21:00:00.000Z",
      to: "2026-03-15T21:00:00.000Z",
      currency: null,
    });
  });

  it("turns Istanbul calendar days into an inclusive-from exclusive-to Instant pair", () => {
    const query = financeSummaryQuery(
      parseFinanceRequest({ from: "2026-03-01", to: "2026-03-31" }),
    );

    // 1 March 2026 00:00 Istanbul = 2026-02-28T21:00:00.000Z
    // exclusive end of 31 March = 1 April 00:00 Istanbul = 2026-03-31T21:00:00.000Z
    expect(query).toEqual({
      from: "2026-02-28T21:00:00.000Z",
      to: "2026-03-31T21:00:00.000Z",
      currency: null,
    });
  });

  it("sends a non-TRY currency and drops TRY so the backend default applies", () => {
    expect(financeSummaryQuery(parseFinanceRequest({ para: "EUR" }))).toEqual({
      from: null,
      to: null,
      currency: "EUR",
    });
  });

  it("drops a junk currency instead of forwarding it as a 400", () => {
    expect(parseFinanceRequest({ para: "lira" }).filters.currency).toBe("TRY");
  });
});
