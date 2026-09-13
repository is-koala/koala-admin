"use client";

import { useActionState, useState, type ReactNode } from "react";

import { Badge, type BadgeTone } from "@/components/ui";
import { cn } from "@/lib/cn";

import { initialDecisionState, type DecisionAction, type DecisionState } from "./decision-state";

/**
 * The decision half of both moderation queues.
 *
 * Two rules from koala-admin#7 and #8 are enforced here rather than described
 * in a comment somewhere:
 *
 *  1. **A decision carries a written reason.** The note is required by this
 *     form and re-checked by the Server Action behind it, because a form
 *     control is a suggestion and an action is an endpoint.
 *  2. **What the decision does is on screen before it is made.** Every option
 *     carries its consequence in the markup — not in a tooltip, not revealed on
 *     hover — and the selected one is repeated in a summary directly above the
 *     button. Report review and company approval are both one-way doors on the
 *     backend (`ReportManager.review` refuses a second verdict;
 *     `CompanyManager.approveCompany` has no counterpart that un-approves), so
 *     "are you sure" has to mean something specific rather than be a dialog.
 *
 * It is a Client Component because the consequence summary tracks the
 * selection, which is exactly the sort of thing worth 2 kB of JavaScript. It
 * imports nothing from `src/server/`; the action arrives as a prop.
 */

export interface DecisionOption {
  /** Submitted as `decision`. The Server Action decides what it means. */
  readonly value: string;
  readonly label: string;
  /** One sentence, in the future tense, saying what happens if this is chosen. */
  readonly consequence: string;
  readonly tone?: BadgeTone;
  /** Set when the backend cannot be undone afterwards — rendered as a warning. */
  readonly irreversible?: boolean;
}

export interface DecisionFormProps {
  action: DecisionAction;
  /**
   * Identity of the record being decided, e.g. `{ reportId }`. Rendered as
   * hidden inputs; the action reads them back out of the `FormData`.
   */
  hiddenFields: Readonly<Record<string, string>>;
  options: readonly DecisionOption[];
  legend: string;
  noteLabel: string;
  noteHint?: string;
  submitLabel: string;
  /** Shortest note the form will submit. The action enforces the same number. */
  minNoteLength?: number;
  /** Longest note the backend accepts. The action must enforce the same number. */
  maxNoteLength?: number;
  /**
   * What the operator has to do *next*, outside this form — a follow-up the
   * panel cannot perform. Rendered under the summary rather than hidden,
   * because "the decision implies an action with no endpoint" is precisely the
   * thing that must not be silent.
   */
  followUp?: ReactNode;
  /** Unique per record; ids have to be stable and distinct across a table. */
  idPrefix: string;
  disabled?: boolean;
  disabledReason?: string;
}

export const DEFAULT_MIN_NOTE_LENGTH = 10;

export function DecisionForm({
  action,
  hiddenFields,
  options,
  legend,
  noteLabel,
  noteHint,
  submitLabel,
  minNoteLength = DEFAULT_MIN_NOTE_LENGTH,
  maxNoteLength,
  followUp,
  idPrefix,
  disabled = false,
  disabledReason,
}: DecisionFormProps) {
  const [state, formAction, pending] = useActionState<DecisionState, FormData>(
    action,
    initialDecisionState,
  );

  const [decision, setDecision] = useState<string>(options[0]?.value ?? "");
  const [note, setNote] = useState("");

  const selected = options.find((option) => option.value === decision) ?? options[0];
  const noteLength = note.trim().length;
  const noteTooShort = noteLength < minNoteLength;

  // Kapalı kayıt formu gizler; başarı cümlesi useActionState'te kalır. Göstermezsek
  // yenilemeden sonra operatör "oldu mu?" diye tekrar basar.
  if (disabled) {
    return (
      <div className="flex flex-col gap-2">
        {state.outcome === "success" ? (
          <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
            {state.message}
          </p>
        ) : null}
        <p className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          {disabledReason ?? "Bu kayıt için karar verilemez."}
        </p>
      </div>
    );
  }

  const noteId = `${idPrefix}-note`;
  const noteErrorId = `${idPrefix}-note-error`;
  const summaryId = `${idPrefix}-summary`;
  const showNoteError = state.field === "note" || (noteLength > 0 && noteTooShort);

  return (
    <form action={formAction} className="flex flex-col gap-4">
      {Object.entries(hiddenFields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <fieldset className="flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-sm font-medium text-ink">{legend}</legend>

        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2",
              option.value === decision
                ? "border-brand bg-brand-soft/40"
                : "border-border-subtle bg-surface",
            )}
          >
            <input
              type="radio"
              name="decision"
              value={option.value}
              checked={option.value === decision}
              onChange={() => setDecision(option.value)}
              className="mt-1"
            />
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2 text-sm font-medium text-ink">
                {option.label}
                {option.irreversible ? <Badge tone="warning">Geri alınamaz</Badge> : null}
              </span>
              <span className="text-xs text-ink-muted">{option.consequence}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-1.5">
        <label htmlFor={noteId} className="text-sm font-medium text-ink">
          {noteLabel}
          <span className="text-danger" aria-hidden="true">
            {" *"}
          </span>
        </label>
        <textarea
          id={noteId}
          name="note"
          rows={3}
          maxLength={maxNoteLength}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          aria-invalid={showNoteError}
          aria-describedby={showNoteError ? noteErrorId : undefined}
          className={cn(
            "w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink",
            "placeholder:text-ink-subtle aria-[invalid=true]:border-danger",
          )}
        />
        {noteHint ? <p className="text-xs text-ink-subtle">{noteHint}</p> : null}
        {showNoteError ? (
          <p id={noteErrorId} className="text-xs font-medium text-danger">
            {state.field === "note" && state.message.length > 0
              ? state.message
              : `Gerekçe en az ${minNoteLength} karakter olmalı.`}
          </p>
        ) : null}
      </div>

      {selected === undefined ? null : (
        <div
          id={summaryId}
          className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-sunken px-3 py-2"
        >
          <p className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
            Bu karar ne yapacak?
          </p>
          <p className="text-sm text-ink">{selected.consequence}</p>
          {followUp ? <div className="text-sm text-ink-muted">{followUp}</div> : null}
        </div>
      )}

      {state.outcome === "error" && state.field === null ? (
        <div role="alert" className="flex flex-col gap-1 rounded-md bg-danger-soft px-3 py-2">
          <p className="text-sm font-medium text-danger">{state.message}</p>
          {state.errorCode || state.requestId ? (
            <p className="font-mono text-xs break-all text-ink-muted">
              {[state.errorCode, state.requestId].filter(Boolean).join(" · ")}
            </p>
          ) : null}
        </div>
      ) : null}

      {state.outcome === "success" ? (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {state.message}
        </p>
      ) : null}

      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={pending || noteTooShort || decision === ""}
          aria-describedby={summaryId}
          className={cn(
            "rounded-md bg-brand px-3 py-2 text-sm font-medium text-white",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          {pending ? "Gönderiliyor…" : submitLabel}
        </button>
        {noteTooShort ? (
          <span className="text-xs text-ink-subtle">Gerekçe yazılmadan karar gönderilemez.</span>
        ) : null}
      </div>
    </form>
  );
}
