"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Dialog, FormField, TextInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  INITIAL_PAYOUT_RECONCILIATION_STATE,
  PAYOUT_RECONCILIATION_FIELDS as FIELD,
  type PayoutReconciliationAction,
  type PayoutReconciliationField,
  type RecordedPayoutEvidence,
} from "@/lib/payout-reconciliation";

interface EvidenceValues {
  payoutId: string;
  settlementReference: string;
  providerReference: string;
  amount: string;
  currency: string;
  settledAt: string;
}

export function PayoutReconciliationForm({
  action,
  recordedPayout,
}: {
  action: PayoutReconciliationAction;
  recordedPayout: RecordedPayoutEvidence;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_PAYOUT_RECONCILIATION_STATE);
  const [values, setValues] = useState<EvidenceValues>({
    payoutId: recordedPayout.payoutId,
    settlementReference: recordedPayout.settlementReference ?? "",
    providerReference: recordedPayout.providerReference ?? "",
    amount: recordedPayout.amount ?? "",
    currency: recordedPayout.currency ?? "",
    settledAt: recordedPayout.settledAt ?? "",
  });
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);

  const succeeded = state.status === "SUCCEEDED";
  const complete = Object.values(values).every((value) => value.trim().length > 0);
  const canSubmit = acknowledged && !pending && !succeeded;

  function update(field: keyof EvidenceValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function errorFor(field: PayoutReconciliationField): string | null {
    return state.field === field ? state.message : null;
  }

  function closeDialog() {
    // Once the request left the browser, this modal is the only place its
    // eventual receipt can appear. Escape and cancel stay inert until it does.
    if (busy.current || pending) return;
    setOpen(false);
    setAcknowledged(false);
  }

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (busy.current || !canSubmit) {
          event.preventDefault();
          return;
        }
        busy.current = true;
      }}
      className="flex max-w-3xl flex-col gap-5 rounded-xl border border-border-subtle bg-surface p-5"
    >
      <p className="rounded-md bg-brand-soft px-3 py-2 text-sm text-brand-strong">
        Sağlayıcı onayı kayıttan dolduruldu. Banka ekstresinde farklı bir satır varsa düzeltin;
        yoksa gözden geçirip onaylayın.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          id="payout-reconciliation-payout-id"
          label="Hakediş kimliği"
          required
          error={errorFor(FIELD.payoutId)}
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.payoutId}
              value={values.payoutId}
              onChange={(event) => update("payoutId", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              readOnly
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="payout-reconciliation-settlement-reference"
          label="Ekstre satırı referansı"
          required
          error={errorFor(FIELD.settlementReference)}
          hint="Sağlayıcı işlem kimliği öntanımlı; banka ekstresinde ayrı bir satır varsa onu yazın."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.settlementReference}
              value={values.settlementReference}
              onChange={(event) => update("settlementReference", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              maxLength={128}
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="payout-reconciliation-provider-reference"
          label="Sağlayıcı referansı"
          required
          error={errorFor(FIELD.providerReference)}
          hint="Hakedişte kayıtlı sağlayıcı işlem kimliğiyle aynı olmalı."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.providerReference}
              value={values.providerReference}
              onChange={(event) => update("providerReference", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              readOnly
              maxLength={128}
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="payout-reconciliation-amount"
          label="Tutar"
          required
          error={errorFor(FIELD.amount)}
          hint="Hakedişte kayıtlı tutar; ekstredeki tutarla karşılaştırın."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.amount}
              value={values.amount}
              onChange={(event) => update("amount", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              readOnly
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="payout-reconciliation-currency"
          label="Para birimi"
          required
          error={errorFor(FIELD.currency)}
          hint="Hakedişte kayıtlı para birimi; ekstreyle aynı olmalı."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.currency}
              value={values.currency}
              onChange={(event) => update("currency", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              readOnly
              minLength={3}
              maxLength={3}
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="payout-reconciliation-settled-at"
          label="Gerçekleşme anı"
          required
          error={errorFor(FIELD.settledAt)}
          hint="Sağlayıcının onay anı. Saat dilimi zorunlu ISO-8601 instant; datetime-local kullanılmaz."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              type="text"
              name={FIELD.settledAt}
              value={values.settledAt}
              onChange={(event) => update("settledAt", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              placeholder="2026-09-09T09:30:00Z"
              autoComplete="off"
            />
          )}
        </FormField>
      </div>

      <div>
        <button
          type="button"
          disabled={!complete || succeeded}
          onClick={() => {
            setAcknowledged(false);
            setOpen(true);
          }}
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          Kanıtı gözden geçir
        </button>
      </div>

      <Dialog
        open={open}
        onClose={closeDialog}
        title="Banka mutabakatını doğrula"
        description="Bu kanıt hakedişi COMPLETED durumuna ilerletebilir."
      >
        <dl className="grid gap-3 rounded-md border border-border-subtle bg-surface-sunken p-4 sm:grid-cols-[max-content_1fr]">
          <Fact label="Hakediş" value={values.payoutId} />
          <Fact label="Ekstre referansı" value={values.settlementReference} />
          <Fact label="Sağlayıcı referansı" value={values.providerReference} />
          <Fact label="Tutar" value={values.amount} />
          <Fact label="Para birimi" value={values.currency} />
          <Fact label="Gerçekleşme anı" value={values.settledAt} />
        </dl>

        <label className="mt-4 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-1"
          />
          <span>Yukarıdaki ekstre ve sağlayıcı kanıtları doğruladım.</span>
        </label>

        {state.status === "REFUSED" || state.status === "BLOCKED" ? (
          <div role="alert" className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-danger">
            <p>{state.message}</p>
            {state.errorCode !== null || state.requestId !== null ? (
              <p className="mt-1 font-mono text-xs break-all text-ink-muted">
                {[state.errorCode, state.requestId].filter(Boolean).join(" · ")}
              </p>
            ) : null}
          </div>
        ) : null}

        {state.status === "SUCCEEDED" && state.payout !== null ? (
          <div role="status" className="mt-4 rounded-md bg-success-soft px-3 py-2 text-success">
            <p className="font-medium">{state.message}</p>
            <p className="mt-1 font-mono text-xs break-all">
              {state.payout.id} · {state.payout.amount} {state.payout.currency} ·{" "}
              {state.payout.completedAt}
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={closeDialog}
            disabled={pending}
            className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink"
          >
            {succeeded ? "Kapat" : "Vazgeç"}
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className={cn(
              "rounded-md bg-brand px-3 py-2 text-sm font-medium text-white",
              "disabled:cursor-not-allowed disabled:opacity-50",
            )}
          >
            {pending ? "Gönderiliyor…" : "Mutabakatı gönder"}
          </button>
        </div>
      </Dialog>
    </form>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-xs font-medium text-ink-muted">{label}</dt>
      <dd className="font-mono text-xs break-all text-ink">{value}</dd>
    </>
  );
}
