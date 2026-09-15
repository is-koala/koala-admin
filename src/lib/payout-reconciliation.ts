/** Plain data shared by the client form and its Server Action. */

export const PAYOUT_RECONCILIATION_FIELDS = {
  payoutId: "payoutId",
  settlementReference: "settlementReference",
  providerReference: "providerReference",
  amount: "amount",
  currency: "currency",
  settledAt: "settledAt",
} as const;

export type PayoutReconciliationField =
  (typeof PAYOUT_RECONCILIATION_FIELDS)[keyof typeof PAYOUT_RECONCILIATION_FIELDS];

export interface RecordedPayoutEvidence {
  readonly payoutId: string;
  readonly providerReference: string | null;
  readonly amount: string | null;
  readonly currency: string | null;
}

export function toRecordedPayoutEvidence(payout: {
  readonly id: string;
  readonly providerReference: string | null;
  readonly amount: string | null;
  readonly currency: string | null;
}): RecordedPayoutEvidence {
  return {
    payoutId: payout.id,
    providerReference: payout.providerReference,
    amount: payout.amount,
    currency: payout.currency,
  };
}

export type PayoutReconciliationStatus = "IDLE" | "SUCCEEDED" | "REFUSED" | "BLOCKED";

export interface ReconciledPayoutSummary {
  readonly id: string;
  /** Backend decimal text, never converted to a JavaScript number. */
  readonly amount: string;
  readonly currency: string;
  readonly completedAt: string;
}

export interface PayoutReconciliationState {
  readonly status: PayoutReconciliationStatus;
  readonly message: string;
  readonly errorCode: string | null;
  readonly requestId: string | null;
  readonly field: PayoutReconciliationField | null;
  readonly payout: ReconciledPayoutSummary | null;
}

export const INITIAL_PAYOUT_RECONCILIATION_STATE: PayoutReconciliationState = {
  status: "IDLE",
  message: "",
  errorCode: null,
  requestId: null,
  field: null,
  payout: null,
};

export type PayoutReconciliationAction = (
  previous: PayoutReconciliationState,
  formData: FormData,
) => Promise<PayoutReconciliationState> | PayoutReconciliationState;
