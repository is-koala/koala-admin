import { describe, expect, it } from "vitest";

import { gateLocation } from "./location-gate";

describe("gateLocation", () => {
  it("keeps the coordinates out of the result unless the reader may see them", () => {
    const gated = gateLocation(40.98, "29.03", false);
    expect(gated).toEqual({ kind: "withheld" });
    expect(JSON.stringify(gated)).not.toContain("40.98");
  });

  it("returns them as text for a reader who may", () => {
    expect(gateLocation(40.98, "29.03", true)).toEqual({
      kind: "shown",
      latitude: "40.98",
      longitude: "29.03",
    });
  });

  it("calls a missing or half coordinate none for everyone, so withheld never means nothing", () => {
    for (const canRead of [true, false]) {
      expect(gateLocation(null, null, canRead)).toEqual({ kind: "none" });
      expect(gateLocation(40.98, null, canRead)).toEqual({ kind: "none" });
      expect(gateLocation(null, 29.03, canRead)).toEqual({ kind: "none" });
    }
  });
});
