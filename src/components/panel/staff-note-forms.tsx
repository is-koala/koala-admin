"use client";

import { useActionState } from "react";

import { Button, FormField, SelectInput, TextArea, TextInput } from "@/components/ui";
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
          <TextArea
            id={id}
            name={STAFF_NOTES_FIELD.body}
            required
            maxLength={NOTE_BODY_MAX_LENGTH}
            rows={3}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </FormField>
      <Feedback state={state.field === "body" ? { ...state, message: "" } : state} />
      <Button size="sm" className="self-start" type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Notu kaydet"}
      </Button>
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
      <TextArea
        id={`staff-note-edit-body-${noteId}`}
        name={STAFF_NOTES_FIELD.body}
        required
        maxLength={NOTE_BODY_MAX_LENGTH}
        rows={3}
        defaultValue={initialBody}
        aria-invalid={state.field === "body" || undefined}
      />
      <Feedback state={state} />
      <Button size="sm" className="self-start" type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "Değişikliği kaydet"}
      </Button>
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
      <Button
        variant="danger-soft"
        size="sm"
        className="self-start"
        type="submit"
        disabled={pending}
      >
        {pending ? "Siliniyor…" : "Notu sil"}
      </Button>
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
          <TextInput
            id={id}
            name={STAFF_NOTES_FIELD.label}
            maxLength={FLAG_LABEL_MAX_LENGTH}
            aria-describedby={describedBy}
            aria-invalid={invalid || undefined}
          />
        )}
      </FormField>
      <Feedback
        state={
          state.field === "kind" || state.field === "label" ? { ...state, message: "" } : state
        }
      />
      <Button size="sm" className="self-start" type="submit" disabled={pending}>
        {pending ? "Kaydediliyor…" : "İşareti koy"}
      </Button>
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
      <Button type="submit" variant="ghost" size="sm" disabled={pending}>
        {pending ? "Kaldırılıyor…" : "Kaldır"}
      </Button>
    </form>
  );
}
