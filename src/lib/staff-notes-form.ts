/**
 * Not ve işaret formunun istemci ile Server Action arasında taşıdığı şekil.
 *
 * `src/lib/`'de duruyor çünkü `"use server"` dosyası sabit dışa aktaramaz ve
 * Client Component `@/server/` okuyamaz (`no-client-secrets.test.ts`).
 */

export type StaffNotesFormOutcome = "idle" | "success" | "error";

export type StaffNotesFormField = "body" | "kind" | "label" | null;

export interface StaffNotesFormState {
  readonly outcome: StaffNotesFormOutcome;
  readonly message: string;
  readonly field: StaffNotesFormField;
  readonly errorCode: string | null;
  readonly requestId: string | null;
}

export const INITIAL_STAFF_NOTES_FORM_STATE: StaffNotesFormState = {
  outcome: "idle",
  message: "",
  field: null,
  errorCode: null,
  requestId: null,
};

export function staffNotesRejected(
  message: string,
  field: StaffNotesFormField = null,
): StaffNotesFormState {
  return { outcome: "error", message, field, errorCode: null, requestId: null };
}

export function staffNotesFailed(
  message: string,
  errorCode: string | null,
  requestId: string | null,
): StaffNotesFormState {
  return { outcome: "error", message, field: null, errorCode, requestId };
}

export function staffNotesSucceeded(message: string): StaffNotesFormState {
  return { outcome: "success", message, field: null, errorCode: null, requestId: null };
}

export const STAFF_NOTES_FIELD = {
  resourceType: "resourceType",
  resourceId: "resourceId",
  noteId: "noteId",
  body: "body",
  kind: "kind",
  label: "label",
} as const;

export type StaffNotesFormAction = (
  state: StaffNotesFormState,
  formData: FormData,
) => Promise<StaffNotesFormState>;
