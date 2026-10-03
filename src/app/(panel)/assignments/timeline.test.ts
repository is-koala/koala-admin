import { describe, expect, it } from "vitest";

import {
  adminAssignmentDetailFixture,
  adminBoardingEventFixture,
  adminSeatTimelineEventFixture,
  adminTransportFixture,
} from "../../../../test/fixtures/admin-detail";
import { assignmentDetailSchema } from "@/server/api/escrow";

import { assignmentTimelineEvents } from "./timeline";

/**
 * koala-admin#133: konum kapısının sunucu yarısı. Backend bu uçta konumu
 * izne göre maskelemiyor (yalnız `payment.read`), bu yüzden süzme çizelge
 * üreticisindedir: bileşene giden veride koordinat hiç olmaz. Sayfa testi
 * aynı kapıyı HTML'den, bu test veriden sınar.
 */

const parse = (overrides: Record<string, unknown> = {}) =>
  assignmentDetailSchema.parse(
    adminAssignmentDetailFixture({
      transport: adminTransportFixture(),
      timeline: [adminSeatTimelineEventFixture(), adminBoardingEventFixture()],
      ...overrides,
    }),
  );

describe("assignmentTimelineEvents — location gate", () => {
  it("leaves no coordinate in the events unless the caller says the reader may see it", () => {
    const events = assignmentTimelineEvents(parse(), []);

    const boarding = events.find(
      (event) => event.boarding !== null && event.boarding !== undefined,
    );
    expect(boarding?.boarding?.location).toEqual({ kind: "withheld" });
    expect(JSON.stringify(events)).not.toContain("40.990412");
    expect(JSON.stringify(events)).not.toContain("29.025631");
  });

  it("refuses an explicit false the same way", () => {
    const events = assignmentTimelineEvents(parse(), [], { canReadLocation: false });
    expect(JSON.stringify(events)).not.toContain("40.990412");
  });

  it("hands the coordinates over when the reader holds user.read_pii", () => {
    const events = assignmentTimelineEvents(parse(), [], { canReadLocation: true });

    const boarding = events.find(
      (event) => event.boarding !== null && event.boarding !== undefined,
    );
    expect(boarding?.boarding?.location).toEqual({
      kind: "shown",
      latitude: "40.990412",
      longitude: "29.025631",
    });
  });

  it("treats half a coordinate as no location rather than printing half a place", () => {
    const events = assignmentTimelineEvents(
      parse({ timeline: [adminBoardingEventFixture({ longitude: null })] }),
      [],
      { canReadLocation: true },
    );
    expect(events.find((event) => event.label === "Biniş kaydedildi")?.boarding?.location).toEqual({
      kind: "none",
    });
  });
});

describe("assignmentTimelineEvents — which timeline rows become events", () => {
  it("takes only BOARDING from timeline[] and the seats from transport.seats[]", () => {
    const events = assignmentTimelineEvents(parse(), []);

    expect(events.filter((event) => event.label === "Koltuk seçildi")).toHaveLength(1);
    expect(events.filter((event) => event.label === "Biniş kaydedildi")).toHaveLength(1);
  });

  it("builds no boarding event, and still the seats, when the server sent no timeline", () => {
    const events = assignmentTimelineEvents(parse({ timeline: undefined }), []);

    expect(events.filter((event) => event.label === "Koltuk seçildi")).toHaveLength(1);
    expect(events.some((event) => event.boarding !== undefined && event.boarding !== null)).toBe(
      false,
    );
  });

  it("drops a boarding whose instant cannot be read instead of misplacing it", () => {
    const events = assignmentTimelineEvents(
      parse({ timeline: [adminBoardingEventFixture({ at: null })] }),
      [],
    );
    expect(events.some((event) => event.label === "Biniş kaydedildi")).toBe(false);
  });
});
