import { describe, expect, it } from "vitest";

import { workSessionSchema } from "@/server/api/escrow";

import { gateWorkSessions } from "./work-sessions";

/**
 * koala-admin#135: konum kapısının sunucu yarısı. Backend bu uçta konumu izne
 * göre maskelemiyor; süzme, bileşene giden veriyi kurarken yapılır. Sayfa testi
 * kapıyı HTML'den, bu test veriden sınar.
 */

const session = (overrides: Record<string, unknown> = {}) =>
  workSessionSchema.parse({
    id: "ws000000-0000-4000-8000-000000000001",
    checkInAt: "2026-09-01T07:58:00Z",
    checkOutAt: "2026-09-01T16:02:00Z",
    checkInLatitude: 40.98,
    checkInLongitude: 29.03,
    checkOutLatitude: "41.01",
    checkOutLongitude: "29.11",
    minutes: 484,
    ...overrides,
  });

describe("gateWorkSessions", () => {
  it("leaves no coordinate anywhere in what it returns when the reader may not see one", () => {
    const gated = gateWorkSessions([session()], false);

    const text = JSON.stringify(gated);
    for (const value of ["40.98", "29.03", "41.01", "29.11"]) expect(text).not.toContain(value);
    expect(Object.keys(gated[0] ?? {})).not.toContain("checkInLatitude");
    expect(gated[0]?.checkInLocation).toEqual({ kind: "withheld" });
    expect(gated[0]?.checkOutLocation).toEqual({ kind: "withheld" });
    // Mesai verisinin kendisi kalır.
    expect(gated[0]?.minutes).toBe(484);
    expect(gated[0]?.checkInAt).toBe("2026-09-01T07:58:00Z");
  });

  it("hands the coordinates over as text when the reader holds user.read_pii", () => {
    const gated = gateWorkSessions([session()], true);

    expect(gated[0]?.checkInLocation).toEqual({
      kind: "shown",
      latitude: "40.98",
      longitude: "29.03",
    });
    expect(gated[0]?.checkOutLocation).toEqual({
      kind: "shown",
      latitude: "41.01",
      longitude: "29.11",
    });
  });

  it("calls an end with no location none, and half a coordinate none too", () => {
    const gated = gateWorkSessions(
      [session({ checkInLatitude: null, checkInLongitude: null, checkOutLongitude: null })],
      true,
    );
    expect(gated[0]?.checkInLocation).toEqual({ kind: "none" });
    expect(gated[0]?.checkOutLocation).toEqual({ kind: "none" });
  });
});
