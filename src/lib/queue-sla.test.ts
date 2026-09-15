import { describe, expect, it } from "vitest";

import { SLA_HOURS, overdueCountText, overdueSummary } from "./queue-sla";

const NOW = new Date("2026-09-14T12:00:00.000Z");

function hoursAgo(hours: number): string {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000).toISOString();
}

describe("overdueSummary", () => {
  it("counts rows older than the threshold and leaves a fresh row alone", () => {
    const summary = overdueSummary([hoursAgo(72), hoursAgo(49), hoursAgo(47)], 3, NOW);
    expect(summary).toEqual({ count: 2, capped: false });
  });

  it("treats exactly the threshold as not yet overdue and a missing timestamp as not overdue", () => {
    expect(overdueSummary([hoursAgo(SLA_HOURS), null, "not-a-date"], 3, NOW)).toEqual({
      count: 0,
      capped: false,
    });
  });

  it("caps an ascending sample that is exhausted while the queue is larger", () => {
    const sample = [hoursAgo(100), hoursAgo(90), hoursAgo(80)];
    expect(overdueSummary(sample, 10, NOW)).toEqual({ count: 3, capped: true });
    // Kuyruk örnekleme sığıyorsa aynı sayı kesindir.
    expect(overdueSummary(sample, 3, NOW)).toEqual({ count: 3, capped: false });
  });

  it("stays exact when a fresh row ends the sample even though the queue is larger", () => {
    expect(overdueSummary([hoursAgo(100), hoursAgo(3)], 10, NOW)).toEqual({
      count: 1,
      capped: false,
    });
  });

  it("reports zero for an empty queue", () => {
    expect(overdueSummary([], 0, NOW)).toEqual({ count: 0, capped: false });
  });

  it("honours a different threshold", () => {
    expect(overdueSummary([hoursAgo(30)], 1, NOW, 24)).toEqual({
      count: 1,
      capped: false,
    });
  });
});

describe("overdueCountText", () => {
  it("appends a plus only when the sample was exhausted", () => {
    expect(overdueCountText({ count: 50, capped: true }, String)).toBe("50+");
    expect(overdueCountText({ count: 7, capped: false }, String)).toBe("7");
  });
});
