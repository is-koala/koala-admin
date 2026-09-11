/**
 * What a moderation decision hands back to the form that submitted it.
 *
 * Deliberately import-free. This module is read by a Client Component
 * (`decision-form.tsx`) *and* by the two Server Actions that answer it, so
 * anything it dragged in would be dragged into the browser bundle as well. The
 * Koala error type stays on the server side of that line; what crosses it is
 * five strings.
 */

export type DecisionOutcome = "idle" | "success" | "error";

export interface DecisionState {
  readonly outcome: DecisionOutcome;
  readonly message: string;
  /**
   * The field the message is about, when it is about one. `null` means the
   * message belongs to the form as a whole — a backend refusal, say, which is
   * nobody's typo.
   */
  readonly field: "decision" | "note" | "reason" | null;
  /** `ErrorResult.errorCode`, when the backend produced one. */
  readonly errorCode: string | null;
  /** The backend's request id — the only handle on the matching log line. */
  readonly requestId: string | null;
}

/**
 * The shape `useActionState` expects: previous state in, next state out.
 * Both queues' actions satisfy it, which is what lets one form component serve
 * two very different decisions.
 */
export type DecisionAction = (state: DecisionState, formData: FormData) => Promise<DecisionState>;

export const initialDecisionState: DecisionState = {
  outcome: "idle",
  message: "",
  field: null,
  errorCode: null,
  requestId: null,
};

/** The decision was not attempted — the form did not carry what it needed. */
export function decisionRejected(
  message: string,
  field: DecisionState["field"] = null,
): DecisionState {
  return { outcome: "error", message, field, errorCode: null, requestId: null };
}

/** The decision was attempted and the backend refused or failed it. */
export function decisionFailed(
  message: string,
  errorCode: string | null,
  requestId: string | null,
): DecisionState {
  return { outcome: "error", message, field: null, errorCode, requestId };
}

export function decisionSucceeded(message: string): DecisionState {
  return { outcome: "success", message, field: null, errorCode: null, requestId: null };
}
