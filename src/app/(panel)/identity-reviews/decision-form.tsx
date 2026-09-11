"use client";

import { useActionState } from "react";

import { initialDecisionState } from "@/components/panel/queue/decision-state";

import { submitIdentityReviewDecision } from "./actions";

const MIN_REASON = 10;
const MAX_REASON = 1000;

export function IdentityReviewDecision({
  reviewId,
  returnTo,
}: {
  reviewId: string;
  returnTo: string;
}) {
  const [state, action, pending] = useActionState(
    submitIdentityReviewDecision,
    initialDecisionState,
  );

  return (
    <div className="flex flex-col gap-4">
      {state.outcome === "error" ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="decision" value="APPROVE" />
        <p className="text-sm text-ink-muted">
          Onay, kullanıcının <code className="font-mono">identityVerified</code> damgasını çip
          olmadan koyar. TCKN benzersizliği backend&apos;de durur. Geri alınamaz.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
        >
          Kimliği onayla
        </button>
      </form>

      <form action={action} className="flex flex-col gap-2">
        <input type="hidden" name="reviewId" value={reviewId} />
        <input type="hidden" name="returnTo" value={returnTo} />
        <input type="hidden" name="decision" value="REJECT" />
        <label htmlFor={`reject-${reviewId}`} className="text-sm font-medium text-ink">
          Ret gerekçesi
        </label>
        <textarea
          id={`reject-${reviewId}`}
          name="reason"
          required
          minLength={MIN_REASON}
          maxLength={MAX_REASON}
          rows={3}
          className="rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink"
        />
        <p className="text-xs text-ink-muted">
          {MIN_REASON}–{MAX_REASON} karakter. Kullanıcı kimliği damgalanmaz ve yeniden yükleyebilir.
        </p>
        <button
          type="submit"
          disabled={pending}
          className="w-fit rounded-md border border-danger px-3 py-2 text-sm font-medium text-danger disabled:opacity-60"
        >
          İncelemeyi reddet
        </button>
      </form>
    </div>
  );
}
