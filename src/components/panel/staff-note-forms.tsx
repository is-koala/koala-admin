"use client";

import { useActionState } from "react";

import { FormField, SelectInput } from "@/components/ui";
import {
  FLAG_LABEL_MAX_LENGTH,
  NOTE_BODY_MAX_LENGTH,
  STAFF_FLAG_KINDS,
  staffFlagKindLabel,
} from "@/lib/staff-notes";
import {
  INITIAL_STAFF_NOTES_FORM_STATE,
  STAFF_NOTES_FIELD,
  type StaffNotesFormAction,
  type StaffNotesFormState,
} from "@/lib/staff-notes-form";

function Feedback({ state }: { state: StaffNotesFormState }) {
  if (state.outcome === "idle" || state.message.length === 0) return null;
  const tone =
    state.outcome === "success"
      ? "rounded-md bg-success-soft px-3 py-2 text-sm text-success"
      : "rounded-md bg-danger-soft px-3 py-2 text-sm text-danger";
  return (
    <p role="status" className={tone}>
      {state.message}
    </p>
  );
}

function HiddenResource({
  resourceType,
  resourceId,
  noteId,
}: {
  resourceType: string;
  resourceId: string;
  noteId?: string;
}) {
  return (
    <>
      <input type="hidden" name={STAFF_NOTES_FIELD.resourceType} value={resourceType} />
      <input type="hidden" name={STAFF_NOTES_FIELD.resourceId} value={resourceId} />
      {noteId === undefined ? null : (
        <input type="hidden" name={STAFF_NOTES_FIELD.noteId} value={noteId} />
      )}
    </>
  );
}

export function StaffNoteComposeForm({
  action,
  resourceType,
  resourceId,
}: {
  action: StaffNotesFormAction;
  resourceType: string;
  resourceId: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STAFF_NOTES_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="staff-note-compose">
      <HiddenResource resourceType={resourceType} resourceId={resourceId} />
      <FormField
        id="staff-note-body"
        label="Yeni not"
        required
        hint={`En fazla ${NOTE_BODY_MAX_LENGTH} karakter. Kimlik numarası, IBAN veya parola yazmayın.`}
        error={state.field === "body" ? state.message : null}
      >
        {({ id, describedBy, invalid }) => (
          <textarea
            id={id}
            name={STAFF_NOTES_FIELD.body}
            required
            maxLength={NOTE_BODY_MAX_LENGTH}
            rows={3}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink placeholder:text-ink-subtle"
          />
        )}
      </FormField>
      <Feedback state={state.field === "body" ? { ...state, message: "" } : state} />
      <button
        type="submit"
        disabled={pending}
        className="button button--primary button--sm self-start"
      >
        {pending ? "Kaydediliyor…" : "Notu kaydet"}
      </button>
    </form>
  );
}

export function StaffNoteEditForm({
  action,
  resourceType,
  resourceId,
  noteId,
  initialBody,
}: {
  action: StaffNotesFormAction;
  resourceType: string;
  resourceId: string;
  noteId: string;
  initialBody: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STAFF_NOTES_FORM_STATE);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      data-testid={`staff-note-edit-${noteId}`}
    >
      <HiddenResource resourceType={resourceType} resourceId={resourceId} noteId={noteId} />
      <label className="sr-only" htmlFor={`staff-note-edit-body-${noteId}`}>
        Notu düzenle
      </label>
      <textarea
        id={`staff-note-edit-body-${noteId}`}
        name={STAFF_NOTES_FIELD.body}
        required
        maxLength={NOTE_BODY_MAX_LENGTH}
        rows={3}
        defaultValue={initialBody}
        aria-invalid={state.field === "body" || undefined}
        className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
      />
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="button button--primary button--sm self-start"
      >
        {pending ? "Kaydediliyor…" : "Değişikliği kaydet"}
      </button>
    </form>
  );
}

export function StaffNoteDeleteForm({
  action,
  resourceType,
  resourceId,
  noteId,
}: {
  action: StaffNotesFormAction;
  resourceType: string;
  resourceId: string;
  noteId: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STAFF_NOTES_FORM_STATE);

  return (
    <form
      action={formAction}
      className="flex flex-col gap-2"
      data-testid={`staff-note-delete-${noteId}`}
    >
      <HiddenResource resourceType={resourceType} resourceId={resourceId} noteId={noteId} />
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="button button--danger-soft button--sm self-start"
      >
        {pending ? "Siliniyor…" : "Notu sil"}
      </button>
    </form>
  );
}

export function StaffFlagSetForm({
  action,
  resourceType,
  resourceId,
}: {
  action: StaffNotesFormAction;
  resourceType: string;
  resourceId: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STAFF_NOTES_FORM_STATE);

  return (
    <form action={formAction} className="flex flex-col gap-3" data-testid="staff-flag-set">
      <HiddenResource resourceType={resourceType} resourceId={resourceId} />
      <FormField
        id="staff-flag-kind"
        label="İşaret"
        required
        error={state.field === "kind" ? state.message : null}
      >
        {({ id, describedBy, invalid }) => (
          <SelectInput
            id={id}
            name={STAFF_NOTES_FIELD.kind}
            required
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          >
            {STAFF_FLAG_KINDS.map((kind) => (
              <option key={kind} value={kind}>
                {staffFlagKindLabel(kind)}
              </option>
            ))}
          </SelectInput>
        )}
      </FormField>
      <FormField
        id="staff-flag-label"
        label="Etiket (isteğe bağlı)"
        hint={`En fazla ${FLAG_LABEL_MAX_LENGTH} karakter.`}
        error={state.field === "label" ? state.message : null}
      >
        {({ id, describedBy, invalid }) => (
          <input
            id={id}
            name={STAFF_NOTES_FIELD.label}
            maxLength={FLAG_LABEL_MAX_LENGTH}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
            className="w-full rounded-lg border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink"
          />
        )}
      </FormField>
      <Feedback
        state={
          state.field === "kind" || state.field === "label" ? { ...state, message: "" } : state
        }
      />
      <button
        type="submit"
        disabled={pending}
        className="button button--primary button--sm self-start"
      >
        {pending ? "Kaydediliyor…" : "İşareti koy"}
      </button>
    </form>
  );
}

export function StaffFlagClearForm({
  action,
  resourceType,
  resourceId,
  kind,
}: {
  action: StaffNotesFormAction;
  resourceType: string;
  resourceId: string;
  kind: string;
}) {
  const [state, formAction, pending] = useActionState(action, INITIAL_STAFF_NOTES_FORM_STATE);

  return (
    <form action={formAction} className="inline" data-testid={`staff-flag-clear-${kind}`}>
      <HiddenResource resourceType={resourceType} resourceId={resourceId} />
      <input type="hidden" name={STAFF_NOTES_FIELD.kind} value={kind} />
      <Feedback state={state} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs font-medium text-ink-muted underline hover:text-ink disabled:cursor-wait"
      >
        {pending ? "Kaldırılıyor…" : "Kaldır"}
      </button>
    </form>
  );
}
