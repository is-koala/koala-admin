import { describe, expect, it } from "vitest";

import { toRecordedPayoutEvidence } from "./payout-reconciliation";

describe("toRecordedPayoutEvidence", () => {
  it("fills statement facts from the provider approval already on the payout", () => {
    expect(
      toRecordedPayoutEvidence({
        id: "9c000000-0000-4000-8000-000000000033",
        providerReference: "iyz-transaction-000033",
        amount: "1000.00",
        currency: "TRY",
        settlementReference: null,
        processingAt: "2026-09-01T08:05:00Z",
        createdAt: "2026-09-01T08:00:00Z",
      }),
    ).toEqual({
      payoutId: "9c000000-0000-4000-8000-000000000033",
      providerReference: "iyz-transaction-000033",
      amount: "1000.00",
      currency: "TRY",
      settlementReference: "iyz-transaction-000033",
      settledAt: "2026-09-01T08:05:00Z",
    });
  });

  it("keeps an explicit statement line and falls back to createdAt when processingAt is missing", () => {
    expect(
      toRecordedPayoutEvidence({
        id: "9c000000-0000-4000-8000-000000000033",
        providerReference: "iyz-transaction-000033",
        amount: "1000.00",
        currency: "TRY",
        settlementReference: "TRF-2026-000033",
        createdAt: "2026-09-01T08:00:00Z",
      }),
    ).toEqual({
      payoutId: "9c000000-0000-4000-8000-000000000033",
      providerReference: "iyz-transaction-000033",
      amount: "1000.00",
      currency: "TRY",
      settlementReference: "TRF-2026-000033",
      settledAt: "2026-09-01T08:00:00Z",
    });
  });
});
