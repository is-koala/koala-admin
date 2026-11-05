import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import {
  ASSIGNMENT_ID,
  adminAssignmentDetailFixture,
  adminBoardingEventFixture,
  adminSeatTimelineEventFixture,
  adminTransportFixture,
  envelope,
} from "../../../test/fixtures/admin-detail";
import { apiUrl, server } from "../../../test/msw";
import { assignmentDetailSchema, escrowSummaryPath, getAssignmentDetail } from "./escrow";

/**
 * koala-admin#133 / koala-backend#335 (T2). `AdminAssignmentDetailDto.timeline[]`
 * yeni sunucuda var; 03.10.2026'da canlı OpenAPI (0.9.31) hâlâ göndermiyor.
 * Panel iki sunucuya karşı da açılmalı: alan yokluğu hata değil, "bu sunucu
 * çizelge göndermiyor" bilgisidir ve `null` ile `[]` ayrı kalır.
 */

async function readDetail(detail: unknown) {
  server.use(
    http.get(apiUrl(escrowSummaryPath(ASSIGNMENT_ID)), () =>
      HttpResponse.json(envelope(escrowSummaryPath(ASSIGNMENT_ID), detail)),
    ),
  );
  return getAssignmentDetail("TOKEN", ASSIGNMENT_ID);
}

describe("the assignment detail against the backend that is deployed today", () => {
  it("reads a body with no timeline at all and keeps the seats the old server does send", async () => {
    // 0.9.31'in `AdminAssignmentDetailDto` alan kümesi: `timeline` yok.
    const deployed = adminAssignmentDetailFixture({
      transport: adminTransportFixture(),
      application: null,
      workSessions: [],
      cancellation: null,
      reviews: [],
    });
    expect("timeline" in deployed).toBe(false);

    const detail = await readDetail(deployed);

    expect(detail.timeline).toBeNull();
    expect(detail.transport?.seats).toHaveLength(1);
    expect(detail.transport?.seats[0]?.createdAt).toBe("2026-08-30T12:00:00Z");
  });

  it("reads an explicit null the same way as an absent field", async () => {
    const detail = await readDetail(adminAssignmentDetailFixture({ timeline: null }));
    expect(detail.timeline).toBeNull();
  });

  it("tells an empty timeline from a missing one", async () => {
    const detail = await readDetail(adminAssignmentDetailFixture({ timeline: [] }));
    expect(detail.timeline).toEqual([]);
  });
});

describe("the T2 timeline rows", () => {
  it("reads a BOARDING row with every field the contract lists", async () => {
    const detail = await readDetail(
      adminAssignmentDetailFixture({
        timeline: [
          adminSeatTimelineEventFixture(),
          adminBoardingEventFixture({
            flags: ["LATE_SYNC", "FAR_FROM_STOP"],
            latitude: "40.990412",
            longitude: "29.025631",
          }),
        ],
      }),
    );

    expect(detail.timeline).toHaveLength(2);
    const [seat, boarding] = detail.timeline ?? [];
    expect(seat?.type).toBe("SEAT");
    expect(boarding).toMatchObject({
      type: "BOARDING",
      kind: "BOARDED",
      source: "WORKER_SCANNED_SHUTTLE_QR",
      flags: ["LATE_SYNC", "FAR_FROM_STOP"],
      recordedById: "w-1",
      recorderRole: "WORKER",
      stopLabel: "Kadıköy İskele",
      stopScheduledAt: "2026-09-01T05:40:00Z",
      capturedAt: "2026-09-01T05:41:00Z",
      receivedAt: "2026-09-01T05:41:04Z",
      latitude: "40.990412",
      longitude: "29.025631",
      distanceToStopMeters: 38,
    });
  });

  it("accepts coordinates as JSON numbers, which is what BigDecimal serialises to", async () => {
    const detail = await readDetail(
      adminAssignmentDetailFixture({ timeline: [adminBoardingEventFixture()] }),
    );
    expect(detail.timeline?.[0]?.latitude).toBe(40.990412);
    expect(detail.timeline?.[0]?.longitude).toBe(29.025631);
  });

  it("keeps a row whose optional fields are null, absent or the account was anonymised", () => {
    const parsed = assignmentDetailSchema.parse({
      ...adminAssignmentDetailFixture(),
      timeline: [
        // KVKK: hesap silinince konum ve uzaklık boşalır, kanıtın kendisi kalır.
        adminBoardingEventFixture({
          latitude: null,
          longitude: null,
          distanceToStopMeters: null,
          recordedById: null,
        }),
        // Yalnız tür ve an; kalan her alan yok.
        { type: "BOARDING", at: "2026-09-01T05:41:00Z" },
      ],
    });

    expect(parsed.timeline).toHaveLength(2);
    const [anonymised, bare] = parsed.timeline ?? [];
    expect(anonymised).toMatchObject({
      latitude: null,
      longitude: null,
      distanceToStopMeters: null,
      recordedById: null,
    });
    expect(bare).toMatchObject({
      id: null,
      kind: null,
      source: null,
      flags: [],
      recordedById: null,
      recorderRole: null,
      stopId: null,
      stopLabel: null,
      stopScheduledAt: null,
      capturedAt: null,
      receivedAt: null,
      latitude: null,
      longitude: null,
      distanceToStopMeters: null,
    });
  });

  it("does not fail the page on a value the panel has never heard of", () => {
    const parsed = assignmentDetailSchema.parse({
      ...adminAssignmentDetailFixture(),
      timeline: [
        adminBoardingEventFixture({
          kind: "ALIGHTED",
          source: "DRIVER_TAPPED",
          recorderRole: "STAFF",
          flags: ["SOMETHING_NEW", "LATE_SYNC"],
        }),
        { ...adminBoardingEventFixture(), type: "DEPARTURE" },
      ],
    });

    expect(parsed.timeline).toHaveLength(2);
    expect(parsed.timeline?.[0]).toMatchObject({
      kind: "ALIGHTED",
      source: "DRIVER_TAPPED",
      recorderRole: "STAFF",
      flags: ["SOMETHING_NEW", "LATE_SYNC"],
    });
    expect(parsed.timeline?.[1]?.type).toBe("DEPARTURE");
  });
});
