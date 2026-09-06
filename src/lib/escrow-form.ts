/**
 * The shape a money form carries between the browser and the Server Action.
 *
 * It lives under `src/lib/` rather than next to the action, and both halves of
 * that are forced. A `"use server"` module may export nothing but async
 * functions, so the constants cannot sit in `actions.ts`; and
 * `no-client-secrets.test.ts` fails the build when a Client Component imports
 * anything from `@/server/`, so they cannot sit in `src/server/escrow/` either.
 * `src/lib/` is where this repo keeps the pieces both sides share.
 *
 * Everything here is plain data. In particular there is no amount *field* the
 * client could set and expect the server to spend: `confirmedAmount` travels in
 * the form for one purpose — proving the operator saw the server's current
 * figure — and `src/server/escrow/operations.ts` compares it and throws it
 * away.
 */

export type EscrowFormStatus = "IDLE" | "SUCCEEDED" | "REFUSED" | "BLOCKED";

export interface EscrowFormState {
  readonly status: EscrowFormStatus;
  readonly message: string;
  readonly errorCode: string | null;
  readonly correlationId: string | null;
  /** What the backend said it moved, already formatted. */
  readonly amountText: string | null;
  /** True when the submission was a duplicate and no second request was sent. */
  readonly deduplicated: boolean;
  /**
   * Echoed back so the dialog can tell "this answer is about the confirmation I
   * am looking at" from "this is left over from the previous one".
   */
  readonly operationKey: string | null;
}

export const INITIAL_ESCROW_FORM_STATE: EscrowFormState = {
  status: "IDLE",
  message: "",
  errorCode: null,
  correlationId: null,
  amountText: null,
  deduplicated: false,
  operationKey: null,
};

/** Field names shared by the form and the action, so a typo is a compile error. */
export const ESCROW_FIELD = {
  operationKey: "operationKey",
  kind: "kind",
  assignmentId: "assignmentId",
  disputeId: "disputeId",
  resolution: "resolution",
  reason: "reason",
  confirmedAmount: "confirmedAmount",
} as const;

/** The Server Action, as a Client Component sees it. */
export type EscrowFormAction = (
  state: EscrowFormState,
  formData: FormData,
) => Promise<EscrowFormState> | EscrowFormState;
