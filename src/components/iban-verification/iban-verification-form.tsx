"use client";

import { useActionState, useEffect, useRef, useState } from "react";

import { Dialog, FormField, TextInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  IBAN_VERIFICATION_FIELDS as FIELD,
  INITIAL_IBAN_VERIFICATION_STATE,
  type IbanVerificationAction,
  type IbanVerificationField,
} from "@/lib/iban-verification";

interface Values {
  reference: string;
  senderIban: string;
  amount: string;
  senderName: string;
}

const EMPTY: Values = {
  reference: "",
  senderIban: "",
  amount: "",
  senderName: "",
};

export function IbanVerificationForm({
  action,
  defaults,
}: {
  action: IbanVerificationAction;
  defaults?: Partial<Values>;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_IBAN_VERIFICATION_STATE);
  const [values, setValues] = useState<Values>({ ...EMPTY, ...defaults });
  const [open, setOpen] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);
  const busy = useRef(false);

  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);

  const succeeded = state.status === "SUCCEEDED";
  const complete =
    values.reference.trim().length > 0 &&
    values.senderIban.trim().length > 0 &&
    values.amount.trim().length > 0;
  const canSubmit = acknowledged && !pending && !succeeded;

  function update(field: keyof Values, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
  }

  function errorFor(field: IbanVerificationField): string | null {
    return state.field === field ? state.message : null;
  }

  function closeDialog() {
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
      <div className="grid gap-4 md:grid-cols-2">
        <FormField
          id="iban-verification-reference"
          label="Ekstre referansı"
          required
          error={errorFor(FIELD.reference)}
          hint="İşçinin transfer açıklamasına yazdığı KOALA-… kodu."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.reference}
              value={values.reference}
              onChange={(event) => update("reference", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="iban-verification-sender-iban"
          label="Gönderen IBAN"
          required
          error={errorFor(FIELD.senderIban)}
          hint="Ekstredeki gönderen hesap. TR IBAN, boşluklu da yazılabilir."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.senderIban}
              value={values.senderIban}
              onChange={(event) => update("senderIban", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              aria-required="true"
              required
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="iban-verification-amount"
          label="Tutar"
          required
          error={errorFor(FIELD.amount)}
          hint="Ekstredeki ondalık metni aynen girin; panel tutarı hesaplamaz."
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
              inputMode="decimal"
              autoComplete="off"
            />
          )}
        </FormField>

        <FormField
          id="iban-verification-sender-name"
          label="Gönderen adı"
          error={errorFor(FIELD.senderName)}
          hint="İsteğe bağlı. Ekstre bir hesap sahibi adı taşıyorsa gönderin (en çok 255 karakter)."
        >
          {({ id, describedBy, invalid }) => (
            <TextInput
              id={id}
              name={FIELD.senderName}
              value={values.senderName}
              onChange={(event) => update("senderName", event.target.value)}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              maxLength={255}
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
        title="IBAN doğrulamasını onayla"
        description="Bu kayıt hesabı VERIFIED durumuna ilerletebilir."
      >
        <dl className="grid gap-3 rounded-md border border-border-subtle bg-surface-sunken p-4 sm:grid-cols-[max-content_1fr]">
          <Fact label="Referans" value={values.reference} />
          <Fact label="Gönderen IBAN" value={values.senderIban} />
          <Fact label="Tutar" value={values.amount} />
          {values.senderName.trim().length > 0 ? (
            <Fact label="Gönderen adı" value={values.senderName} />
          ) : null}
        </dl>

        <label className="mt-4 flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            className="mt-1"
          />
          <span>Yukarıdaki ekstre satırını doğruladım.</span>
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

        {state.status === "SUCCEEDED" && state.account !== null ? (
          <div role="status" className="mt-4 rounded-md bg-success-soft px-3 py-2 text-success">
            <p className="font-medium">{state.message}</p>
            <p className="mt-1 font-mono text-xs break-all">
              {state.account.maskedIban} · {state.account.verificationStatus}
              {state.account.primary ? " · birincil" : ""}
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
            {pending ? "Gönderiliyor…" : "Doğrulamayı gönder"}
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
