import { describe, expect, it } from "vitest";

import type { EscrowSummary } from "@/server/api/escrow";

import {
  escrowFigure,
  normaliseMoney,
  refundAvailability,
  releaseAvailability,
  sameMoney,
} from "./figures";

/**
 * The rules that decide *which* server figure moves, and the comparison that
 * proves the operator confirmed it.
 *
 * `normaliseMoney` is the only money handling in the panel that touches the
 * digits at all, so it gets the hardest test in the file: it must treat
 * `"1240.00"` and `1240` as one amount and must never turn a `BigDecimal` into
 * a float on the way.
 */

const SUMMARY: EscrowSummary = {
  id: "assignment-1",
  status: "COMPLETED",
  paymentStatus: "HELD_IN_ESCROW",
  currency: "TRY",
  workerPayout: "1240.50",
  commissionAmount: "137.83",
  commissionRate: "0.1000",
  totalCharged: "1378.33",
  workHours: 8,
  jobTitle: "Garsonluk",
  worker: {
    id: "w-1",
    firstName: "Ayşe",
    lastName: "Yılmaz",
    username: "ayse",
    profilePictureUrl: null,
  },
  employer: {
    id: "e-1",
    firstName: "Mehmet",
    lastName: "Demir",
    username: "mehmet",
    profilePictureUrl: null,
  },
  companyName: "Koala Kafe",
  settledPayment: {
    id: "p-1",
    currency: "TRY",
    totalCharged: "1378.33",
    workerPayout: "1240.50",
    commissionAmount: "137.83",
    commissionRate: "0.1000",
    completedAt: "2026-09-01T10:00:00Z",
  },
};

describe("which figure moves", () => {
  it("pays the worker jobAssignment.workerPayout, the field PayoutManager reads", () => {
    const figure = escrowFigure(SUMMARY, "WORKER");

    expect(figure.amount).toBe("1240.50");
    expect(figure.partyName).toBe("Ayşe Yılmaz");
    expect(figure.partyRole).toBe("İşçi");
    expect(figure.source).toBe("jobAssignment.workerPayout");
  });

  it("refunds the settled payment's total, not the assignment's snapshot", () => {
    // They agree here; the point is which one is read. When they disagree, the
    // one that moves is the payment's, so that is the one shown.
    const drifted: EscrowSummary = {
      ...SUMMARY,
      totalCharged: "9999.99",
      settledPayment: { ...SUMMARY.settledPayment!, totalCharged: "1378.33" },
    };

    const figure = escrowFigure(drifted, "EMPLOYER");

    expect(figure.amount).toBe("1378.33");
    expect(figure.partyName).toBe("Mehmet Demir · Koala Kafe");
    expect(figure.partyRole).toBe("İşveren");
  });

  it("returns null rather than a substitute when there is no settled payment", () => {
    const figure = escrowFigure({ ...SUMMARY, settledPayment: null }, "EMPLOYER");

    // Null is the signal to withhold the operation. Falling back to
    // `assignment.totalCharged` here would be the panel inventing the figure.
    expect(figure.amount).toBeNull();
  });
});

describe("what the backend would accept", () => {
  it("allows a release only on a COMPLETED assignment whose money is in escrow", () => {
    expect(releaseAvailability(SUMMARY).allowed).toBe(true);

    expect(releaseAvailability({ ...SUMMARY, status: "IN_PROGRESS" })).toMatchObject({
      allowed: false,
    });
    expect(releaseAvailability({ ...SUMMARY, paymentStatus: "RELEASED_TO_WORKER" })).toMatchObject({
      allowed: false,
    });
  });

  it("refuses a release when the backend supplied no worker payout", () => {
    const availability = releaseAvailability({ ...SUMMARY, workerPayout: null });

    expect(availability.allowed).toBe(false);
    expect(availability.reason).toContain("Tutarı bilmeden");
  });

  it("allows a refund from escrow regardless of assignment status, like canRefund", () => {
    expect(refundAvailability({ ...SUMMARY, status: "IN_PROGRESS" }).allowed).toBe(true);
    expect(refundAvailability({ ...SUMMARY, paymentStatus: "REFUNDED" }).allowed).toBe(false);
    expect(refundAvailability({ ...SUMMARY, settledPayment: null }).allowed).toBe(false);
  });
});

describe("comparing money as text", () => {
  it("treats trailing zeros as the same amount", () => {
    expect(normaliseMoney("1240.50")).toBe("1240.5");
    expect(normaliseMoney(1240.5)).toBe("1240.5");
    expect(normaliseMoney("1240.00")).toBe("1240");
    expect(normaliseMoney(1240)).toBe("1240");
    expect(normaliseMoney("0.10")).toBe("0.1");
    expect(normaliseMoney("-0.00")).toBe("0");
  });

  it("says yes only when the amounts are actually equal", () => {
    expect(sameMoney("1240.50", 1240.5)).toBe(true);
    expect(sameMoney("1240.00", "1240")).toBe(true);
    expect(sameMoney("1240.50", "1240.51")).toBe(false);
    expect(sameMoney("1240.50", "12405")).toBe(false);
    // A missing figure is never "the same as" anything, so a movement whose
    // amount could not be read can never pass the confirmation check.
    expect(sameMoney(null, "1240.50")).toBe(false);
    expect(sameMoney("1240.50", null)).toBe(false);
  });

  it("leaves anything that is not a plain decimal alone, so it compares unequal", () => {
    // Better a comparison that fails than a silent coercion of "1.240,50".
    expect(normaliseMoney("1.240,50")).toBe("1.240,50");
    expect(sameMoney("1.240,50", "1240.5")).toBe(false);
  });
});
