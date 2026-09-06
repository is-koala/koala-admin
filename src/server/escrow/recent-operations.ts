import "server-only";

/**
 * The last few money movements *this panel process* performed, so the screen
 * can show them.
 *
 * **This is not an audit log, and it must never be mistaken for one.**
 * koala-admin#6 is explicit that the durable record is koala-backend#15's audit
 * row, written by the authorization interceptor on the backend — a row this
 * panel neither writes nor could write, and which is retained for ten years for
 * the FINANCIAL permissions. Building a second record here would be building a
 * second source of truth for money, which is worse than having none.
 *
 * What this is instead is a screen affordance with three deliberate limits:
 *
 *  - **In process, in memory.** It is lost on restart and it is not shared
 *    between instances. An operator behind a load balancer may see a different
 *    list on the next request, and the screen says so.
 *  - **Bounded.** {@link CAPACITY} entries, oldest dropped.
 *  - **Only what the server said.** Every entry is written *after* the backend
 *    answered, from the backend's own response — the payout id, the amount it
 *    actually paid, or the error code it refused with. Nothing is recorded
 *    optimistically, so an entry here means the request completed, not that a
 *    button was clicked.
 *
 * It exists because "son işlemler ekranda görünsün" is a real operator need —
 * after a release you want to see it landed — and waiting for #15 would leave
 * the money screen with no feedback at all.
 */

export const CAPACITY = 20;

export type RecordedOperationKind = "RESOLVE_DISPUTE" | "RELEASE" | "REFUND";

export type RecordedOperationOutcome = "SUCCEEDED" | "REFUSED";

export interface RecordedOperation {
  /** The client-minted key that also de-duplicated the submit. */
  readonly operationKey: string;
  readonly kind: RecordedOperationKind;
  readonly outcome: RecordedOperationOutcome;
  readonly assignmentId: string;
  readonly disputeId: string | null;
  /** Staff display name as `/admin/me` resolved it. */
  readonly actor: string;
  /** Who the money went to, in words, or `null` when it did not move. */
  readonly beneficiary: string | null;
  /**
   * The amount **the backend reported**, already formatted through
   * `lib/format`. Null when the backend's response carried no figure — a refund
   * answers a bare `SuccessResult` — rather than filled in from the panel's own
   * read.
   */
  readonly amountText: string | null;
  readonly reason: string;
  /** Backend `errorCode` when `outcome` is `REFUSED`. */
  readonly errorCode: string | null;
  /** The backend's own message, Turkish, verbatim. */
  readonly message: string;
  readonly requestId: string | null;
  /** ISO-8601, minted here — the only field not sourced from the backend. */
  readonly at: string;
}

/**
 * Module scope, which in Next.js means "for as long as this server process
 * lives". Not a cache: nothing is read back to answer a question, so it can go
 * stale without misleading anybody about the state of the money.
 */
const entries: RecordedOperation[] = [];

export function recordOperation(entry: RecordedOperation): void {
  entries.unshift(entry);
  if (entries.length > CAPACITY) {
    entries.length = CAPACITY;
  }
}

/** Newest first. A copy, so a caller cannot mutate the buffer. */
export function recentOperations(limit = CAPACITY): readonly RecordedOperation[] {
  return entries.slice(0, Math.max(0, limit));
}

/** Test seam. Never called by application code. */
export function clearRecentOperations(): void {
  entries.length = 0;
}
