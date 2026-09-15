"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";

import { Badge, Dialog, FormField, SelectInput } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  ESCROW_FIELD,
  INITIAL_ESCROW_FORM_STATE,
  escrowReasonMaxLength,
  type EscrowFormAction,
} from "@/lib/escrow-form";

/**
 * The only way a person moves money in this panel.
 *
 * ## The two steps, and why the first one is not a button press
 *
 * koala-admin#6 asks for a two-step confirmation that "re-displays the exact
 * amount and the receiving party", explicitly *not* a generic "are you sure".
 * So step one is the intent — pick the operation, write the reason — and step
 * two is a dialog that states, in words, the figure and the person:
 *
 *     ₺1.240,00 → Ayşe Yılmaz (İşçi)
 *
 * plus where that figure came from on the backend, plus a checkbox the operator
 * has to tick to say they read it. Three separate deliberate acts before a real
 * transfer, and none of them is the word "confirm" on its own.
 *
 * ## What this component is not allowed to do
 *
 * It never computes an amount. `amountText` arrives already formatted by the
 * server through `lib/format`, and `confirmedAmount` is the server's raw figure
 * travelling back untouched so the action can prove the operator saw the
 * current number. There is no arithmetic in this file and there must not be.
 *
 * ## Double submission
 *
 * Three layers, because a duplicated release is a real financial incident:
 *
 *  1. `disabled={pending}` on the submit button.
 *  2. A `submit` handler that cancels the event outright while a request is in
 *     flight, so a fast double click cannot slip between renders.
 *  3. The `operationKey` in the form, which
 *     `src/server/escrow/operations.ts` uses to collapse two submissions into
 *     one backend request. That is the layer that actually holds, because it
 *     works even if this component is bypassed entirely — a Server Action is a
 *     public endpoint.
 */

export interface MoneyMovement {
  /**
   * The backend's own figure, canonicalised, echoed back for the equality
   * check. Never rendered — {@link amountText} is what a person reads.
   */
  readonly confirmedAmount: string;
  /** Formatted on the server through `lib/format`. */
  readonly amountText: string;
  readonly partyName: string;
  /** "İşçi" / "İşveren". */
  readonly partyRole: string;
  /** Which backend field the figure came from. */
  readonly source: string;
}

export interface ResolutionChoice {
  readonly resolution: string;
  readonly label: string;
  readonly description: string;
  /** Null when the decision touches no money (`DISMISSED`). */
  readonly movement: MoneyMovement | null;
  /** Set when this decision cannot be offered; the option is disabled. */
  readonly unavailableReason: string | null;
}

export interface EscrowOperationFormProps {
  action: EscrowFormAction;
  kind: "RELEASE" | "REFUND" | "RESOLVE_DISPUTE";
  assignmentId: string;
  disputeId: string | null;
  /** Label on the button that opens the confirmation. */
  triggerLabel: string;
  /** What the dialog is called. */
  title: string;
  /** One sentence about what will happen. */
  summary: string;
  /** `RELEASE` / `REFUND`: the single movement, already priced by the server. */
  movement?: MoneyMovement | null;
  /** `RESOLVE_DISPUTE`: the decisions on offer. */
  choices?: readonly ResolutionChoice[];
  /** Set when the operation cannot be offered at all; the trigger is disabled. */
  disabledReason?: string | null;
  /** Extra warning shown inside the dialog, above the confirmation. */
  notice?: string | null;
  tone?: "primary" | "danger";
}

/** Unique per confirmation, not a secret — an idempotency token for one dialog. */
function newOperationKey(): string {
  const source = globalThis.crypto;
  if (source !== undefined && typeof source.randomUUID === "function") {
    return source.randomUUID();
  }
  return `op-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

export function EscrowOperationForm({
  action,
  kind,
  assignmentId,
  disputeId,
  triggerLabel,
  title,
  summary,
  movement = null,
  choices,
  disabledReason = null,
  notice = null,
  tone = "primary",
}: EscrowOperationFormProps) {
  const [state, formAction, pending] = useActionState(action, INITIAL_ESCROW_FORM_STATE);
  const [open, setOpen] = useState(false);
  const [operationKey, setOperationKey] = useState(newOperationKey);
  const [reason, setReason] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  const [selected, setSelected] = useState<string>(() => firstAvailable(choices));

  const busy = useRef(false);
  const fieldPrefix = useId();

  useEffect(() => {
    if (!pending) busy.current = false;
  }, [pending]);

  const choice = choices?.find((entry) => entry.resolution === selected) ?? null;
  const activeMovement = kind === "RESOLVE_DISPUTE" ? (choice?.movement ?? null) : movement;
  const movesMoney = activeMovement !== null;

  const settled = state.status !== "IDLE" && state.operationKey === operationKey;
  const succeeded = settled && state.status === "SUCCEEDED";

  const reasonTooShort = reason.trim().length < (movesMoney ? 10 : 1);
  const blockedChoice = choice?.unavailableReason ?? null;
  const canSubmit =
    !pending && !succeeded && !reasonTooShort && acknowledged && blockedChoice === null;

  function openDialog() {
    // A fresh key per confirmation: the guard must collapse *this* dialog's
    // duplicate submissions, not last week's.
    setOperationKey(newOperationKey());
    setAcknowledged(false);
    setOpen(true);
  }

  function closeDialog() {
    setOpen(false);
    setAcknowledged(false);
    if (state.status === "SUCCEEDED") {
      setReason("");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {kind === "RESOLVE_DISPUTE" && choices !== undefined ? (
        <FormField
          id={`${fieldPrefix}-resolution`}
          label="Karar"
          required
          hint={choice?.description}
          error={blockedChoice}
        >
          {({ id, describedBy, invalid }) => (
            <SelectInput
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={selected}
              onChange={(event) => setSelected(event.target.value)}
            >
              {choices.map((entry) => (
                <option
                  key={entry.resolution}
                  value={entry.resolution}
                  disabled={entry.unavailableReason !== null}
                >
                  {entry.label}
                  {entry.movement === null ? "" : ` — ${entry.movement.amountText}`}
                </option>
              ))}
            </SelectInput>
          )}
        </FormField>
      ) : null}

      <FormField
        id={`${fieldPrefix}-reason`}
        label="Gerekçe"
        required
        hint={
          movesMoney
            ? "Zorunlu ve serbest metin. Para hareketleri denetim kaydında 10 yıl saklanır; bu gerekçe o kaydın okunabilir tarafıdır (en az 10 karakter)."
            : "Zorunlu ve serbest metin."
        }
      >
        {({ id, describedBy }) => (
          <textarea
            id={id}
            aria-describedby={describedBy}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={escrowReasonMaxLength(kind)}
            className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
            placeholder="Ne oldu ve neden bu karar verildi?"
          />
        )}
      </FormField>

      <div>
        <button
          type="button"
          onClick={openDialog}
          disabled={disabledReason !== null || reasonTooShort}
          className={tone === "danger" ? "button button--danger" : "button button--primary"}
        >
          {triggerLabel}
        </button>
      </div>

      {disabledReason !== null ? (
        <p className="text-xs text-ink-muted" data-testid="escrow-disabled-reason">
          {disabledReason}
        </p>
      ) : null}

      {open ? (
        <Dialog open onClose={closeDialog} title={title} description={summary}>
          <form
            action={formAction}
            onSubmit={(event) => {
              if (busy.current || !canSubmit) {
                event.preventDefault();
                return;
              }
              busy.current = true;
            }}
            className="flex flex-col gap-4"
          >
            <input type="hidden" name={ESCROW_FIELD.operationKey} value={operationKey} />
            <input type="hidden" name={ESCROW_FIELD.kind} value={kind} />
            <input type="hidden" name={ESCROW_FIELD.assignmentId} value={assignmentId} />
            <input type="hidden" name={ESCROW_FIELD.disputeId} value={disputeId ?? ""} />
            <input
              type="hidden"
              name={ESCROW_FIELD.resolution}
              value={kind === "RESOLVE_DISPUTE" ? selected : ""}
            />
            <input type="hidden" name={ESCROW_FIELD.reason} value={reason} />
            <input
              type="hidden"
              name={ESCROW_FIELD.confirmedAmount}
              value={activeMovement?.confirmedAmount ?? ""}
            />

            {activeMovement === null ? (
              <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm text-ink">
                Bu karar emanetteki paraya dokunmaz.
              </p>
            ) : (
              <div
                className="flex flex-col gap-2 rounded-md border border-border-strong bg-surface-sunken px-4 py-3"
                data-testid="money-confirmation"
              >
                <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">
                  Taşınacak tutar ve alacak taraf
                </p>
                <p className="text-2xl font-semibold text-ink" data-testid="confirmation-amount">
                  {activeMovement.amountText}
                </p>
                <p className="text-sm text-ink">
                  <span className="text-ink-muted">Alacak taraf: </span>
                  <span className="font-medium" data-testid="confirmation-party">
                    {activeMovement.partyName}
                  </span>{" "}
                  <Badge>{activeMovement.partyRole}</Badge>
                </p>
                <p className="text-xs text-ink-subtle">
                  Tutar sunucudan okundu ({activeMovement.source}); panel hesaplamaz. Gönderilen
                  istek tutar taşımaz — tutarı backend kendi kaydından belirler.
                </p>
              </div>
            )}

            {notice === null ? null : (
              <p className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink">
                {notice}
              </p>
            )}

            <div className="flex flex-col gap-1">
              <p className="text-xs font-medium tracking-wide text-ink-muted uppercase">Gerekçe</p>
              <p className="text-sm whitespace-pre-wrap text-ink">{reason.trim()}</p>
            </div>

            <label className="flex items-start gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
                className="mt-1"
              />
              <span>
                {activeMovement === null
                  ? "Kararı ve gerekçeyi doğruladım."
                  : "Yukarıdaki tutarı ve alacak tarafı doğruladım."}
              </span>
            </label>

            {settled ? (
              <p
                role="status"
                data-testid="escrow-result"
                className={cn(
                  "rounded-md px-3 py-2 text-sm",
                  state.status === "SUCCEEDED"
                    ? "bg-success-soft text-success"
                    : "bg-danger-soft text-danger",
                )}
              >
                {state.message}
                {state.amountText === null ? null : ` (${state.amountText})`}
                {state.deduplicated
                  ? " Bu gönderim yinelenmişti; ikinci istek gönderilmedi."
                  : null}
                {state.requestId === null ? null : ` · ${state.requestId}`}
              </p>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={closeDialog}
                className="button button--secondary button--sm"
              >
                {succeeded ? "Kapat" : "Vazgeç"}
              </button>
              <button
                type="submit"
                disabled={!canSubmit}
                data-testid="escrow-confirm"
                className={
                  tone === "danger"
                    ? "button button--danger button--sm"
                    : "button button--primary button--sm"
                }
              >
                {pending ? "Gönderiliyor…" : "Onayla ve gönder"}
              </button>
            </div>
          </form>
        </Dialog>
      ) : null}
    </div>
  );
}

function firstAvailable(choices: readonly ResolutionChoice[] | undefined): string {
  if (choices === undefined || choices.length === 0) return "";
  const available = choices.find((choice) => choice.unavailableReason === null);
  return (available ?? choices[0])?.resolution ?? "";
}
