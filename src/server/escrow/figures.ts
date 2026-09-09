import { safeUserName } from "@/server/api/users";
import type { EscrowSummary, Money } from "@/server/api/escrow";

/**
 * Which number moves, and to whom — read off the backend's own code paths.
 *
 * This module is the single place the panel decides *which server-supplied
 * field* a given money movement will pay out. It never adds, subtracts or
 * scales anything: every function here either returns a figure the backend
 * sent, or returns `null` and lets the caller refuse to offer the operation.
 *
 * Pure — no network, no session, nothing to stub — so the arithmetic-free claim
 * above is checkable by a plain unit test rather than by reading.
 */

export type EscrowDirection = "WORKER" | "EMPLOYER";

export interface EscrowFigure {
  readonly direction: EscrowDirection;
  /** The party the money reaches, named from `SafeUserDto`. */
  readonly partyName: string;
  /** "İşçi" / "İşveren", for the sentence next to the amount. */
  readonly partyRole: string;
  /**
   * The server's decimal string, verbatim. `null` is retained as the caller's
   * fail-closed signal even though the current pricing DTO requires the field.
   */
  readonly amount: Money | null;
  readonly currency: string;
  /** Which backend field this came from, shown to the operator as provenance. */
  readonly source: string;
}

/**
 * `AdminAssignmentDto.pricing` is the backend-authored snapshot shown to the
 * operator. The panel selects the worker or employer side without recomputing
 * either figure.
 */
export function escrowFigure(summary: EscrowSummary, direction: EscrowDirection): EscrowFigure {
  if (direction === "WORKER") {
    return {
      direction,
      partyName: safeUserName(summary.worker),
      partyRole: "İşçi",
      amount: summary.pricing.workerPayout,
      currency: summary.pricing.currency,
      source: "pricing.workerPayout",
    };
  }

  return {
    direction,
    partyName:
      summary.companyName !== null && summary.companyName.length > 0
        ? `${safeUserName(summary.employer)} · ${summary.companyName}`
        : safeUserName(summary.employer),
    partyRole: "İşveren",
    amount: summary.pricing.employerTotal,
    currency: summary.pricing.currency,
    source: "pricing.employerTotal",
  };
}

/**
 * Whether the backend would even accept the movement, mirroring
 * `PaymentStateMachine`, so the screen can explain a greyed-out button instead
 * of letting an operator discover the rule through a 409.
 *
 * Mirroring, not deciding: `@RequiresPermission` and the state machine on the
 * backend remain the authority, and the panel offering a button the backend
 * refuses is a bad afternoon, not a bad outcome.
 */
export interface EscrowAvailability {
  readonly allowed: boolean;
  /** Why not, in Turkish. `null` when it is allowed. */
  readonly reason: string | null;
}

/** `PaymentStateMachine.canRelease`: COMPLETED assignment, money in escrow. */
export function releaseAvailability(summary: EscrowSummary): EscrowAvailability {
  if (summary.paymentStatus !== "HELD_IN_ESCROW") {
    return {
      allowed: false,
      reason: `Para emanette değil (ödeme durumu: ${summary.paymentStatus}). Backend yalnız HELD_IN_ESCROW durumundan çıkış yapar.`,
    };
  }

  if (summary.status !== "COMPLETED") {
    return {
      allowed: false,
      reason: `Atama tamamlanmamış (atama durumu: ${summary.status}). Backend yalnız COMPLETED atamada işçiye çıkış yapar.`,
    };
  }

  return { allowed: true, reason: null };
}

/** `PaymentStateMachine.canRefund`: money in escrow. */
export function refundAvailability(summary: EscrowSummary): EscrowAvailability {
  if (summary.paymentStatus !== "HELD_IN_ESCROW") {
    return {
      allowed: false,
      reason: `Para emanette değil (ödeme durumu: ${summary.paymentStatus}). İşçiye çıkmış ya da iade edilmiş para tekrar iade edilemez.`,
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Are two money figures the same amount?
 *
 * Compared as decimal *text*, never as JavaScript numbers: `0.1 + 0.2` is the
 * canonical reason a panel must not do arithmetic on money, and parsing a
 * `BigDecimal` into a float to compare it is the same mistake wearing a
 * different hat. `"1240"`, `"1240.00"` and `1240` are one amount; `"1240.01"`
 * is not.
 */
export function sameMoney(left: Money | null, right: Money | null): boolean {
  if (left === null || right === null) return false;
  return normaliseMoney(left) === normaliseMoney(right);
}

export function normaliseMoney(value: Money): string {
  const text = typeof value === "number" ? value.toString() : value.trim();

  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    // Not a plain decimal — an exponent form, a thousands separator, something
    // unexpected. Return it untouched so a comparison fails loudly rather than
    // silently treating two different strings as equal.
    return text;
  }

  const negative = text.startsWith("-");
  const [whole = "0", fraction = ""] = text.replace("-", "").split(".");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const trimmedWhole = whole.replace(/^0+(?=\d)/, "");
  const body = trimmedFraction.length > 0 ? `${trimmedWhole}.${trimmedFraction}` : trimmedWhole;

  return negative && body !== "0" ? `-${body}` : body;
}
