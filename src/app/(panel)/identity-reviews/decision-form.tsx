"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { initialDecisionState } from "@/components/panel/queue/decision-state";
import { Dialog } from "@/components/ui";

import { submitIdentityReviewDecision } from "./actions";

const MIN_REASON = 10;
const MAX_REASON = 1000;

export function IdentityReviewDecision({
  reviewId,
  returnTo,
  canApprove,
}: {
  reviewId: string;
  returnTo: string;
  canApprove: boolean;
}) {
  const [state, action, pending] = useActionState(
    submitIdentityReviewDecision,
    initialDecisionState,
  );
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = useRef(false);

  // Damga geri alınamaz; IBAN/emanet ile aynı diyalog+onay kutusu. Bu yalnız
  // personeli durdurur — sahte POST'u Server Action yeniden doğrular.

  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);

  const canSubmit = canApprove && acknowledged && !pending;

  function closeDialog() {
    if (busy.current || pending) return;
    setOpen(false);
    setAcknowledged(false);
  }

  return (
    <div className="flex flex-col gap-4">
      {state.outcome === "error" ? (
        <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          {state.message}
        </p>
      ) : null}

      {canApprove ? (
        <form
          action={action}
          onSubmit={(event) => {
            if (busy.current || !canSubmit) {
              event.preventDefault();
              return;
            }
            busy.current = true;
          }}
          className="flex flex-col gap-2"
        >
          <input type="hidden" name="reviewId" value={reviewId} />
          <input type="hidden" name="returnTo" value={returnTo} />
          <input type="hidden" name="decision" value="APPROVE" />
          <p className="text-sm text-ink-muted">
            Onay kimlik damgasını çip olmadan koyar. Aynı TCKN ikinci kez onaylanamaz. Geri
            alınamaz.
          </p>
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setAcknowledged(false);
              setOpen(true);
            }}
            className="w-fit rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            Kimliği onayla
          </button>
          <Dialog
            open={open}
            onClose={closeDialog}
            title="Kimlik onayını onayla"
            description="Onay kimlik damgasını çip olmadan koyar ve geri alınamaz. Aynı TCKN ikinci kez onaylanamaz."
          >
            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1"
              />
              <span>Bu onayın geri alınamayacağını anlıyorum.</span>
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                disabled={pending}
                className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink"
              >
                Vazgeç
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? "Gönderiliyor…" : "Onayı gönder"}
              </button>
            </div>
          </Dialog>
        </form>
      ) : (
        <p className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          Onay kapalı. Dört TCKK fotoğrafı (yüz, ön, arka, yüzün altında) olmadan kimlik damgası
          konulamaz. İncelemeyi reddedebilirsiniz; kullanıcı belgeleri yeniden yükler.
        </p>
      )}

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
