"use server";

import {
  FLAG_LABEL_MAX_LENGTH,
  NOTE_BODY_MAX_LENGTH,
  isStaffFlagKind,
  isStaffResourceType,
  listPathFor,
  objectPathFor,
} from "@/lib/staff-notes";
import {
  STAFF_NOTES_FIELD,
  staffNotesFailed,
  staffNotesRejected,
  staffNotesSucceeded,
  type StaffNotesFormState,
} from "@/lib/staff-notes-form";
import { isKoalaApiError } from "@/server/api/errors";
import {
  clearStaffFlag,
  createStaffNote,
  deleteStaffNote,
  setStaffFlag,
  updateStaffNote,
} from "@/server/api/staff-notes";
import { getKoalaAccessToken } from "@/server/auth/session";
import { guardDecision } from "@/server/queue/decisions";
import { revalidateAfterWrite } from "@/server/queue/revalidate-after-write";

/**
 * Not ve işaret yazımları. Sayfa kapısı bunları korumaz — her eylem
 * `guardDecision` ile izni yeniden çözer. Denetim satırını backend yazar;
 * panelin işi BFF'yi atlamamak.
 */

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function failureFrom(error: unknown, fallback: string): StaffNotesFormState {
  if (isKoalaApiError(error)) {
    return staffNotesFailed(error.message, error.errorCode, error.requestId);
  }
  return staffNotesFailed(error instanceof Error ? error.message : fallback, null, null);
}

function readResource(formData: FormData) {
  const resourceType = field(formData, STAFF_NOTES_FIELD.resourceType).trim();
  const resourceId = field(formData, STAFF_NOTES_FIELD.resourceId).trim();
  if (!isStaffResourceType(resourceType) || resourceId === "") {
    return null;
  }
  return { resourceType, resourceId };
}

function readBody(
  formData: FormData,
): { ok: true; body: string } | { ok: false; state: StaffNotesFormState } {
  const body = field(formData, STAFF_NOTES_FIELD.body).trim();
  if (body.length === 0) {
    return { ok: false, state: staffNotesRejected("Not boş olamaz.", "body") };
  }
  if (body.length > NOTE_BODY_MAX_LENGTH) {
    return {
      ok: false,
      state: staffNotesRejected(`Not en fazla ${NOTE_BODY_MAX_LENGTH} karakter olabilir.`, "body"),
    };
  }
  return { ok: true, body };
}

function revalidateKnown(resourceType: string, resourceId: string): void {
  if (!isStaffResourceType(resourceType)) return;
  revalidateAfterWrite(objectPathFor(resourceType, resourceId), listPathFor(resourceType));
}

export async function submitStaffNoteCreate(
  _state: StaffNotesFormState,
  formData: FormData,
): Promise<StaffNotesFormState> {
  const denied = await guardDecision("note.write");
  if (denied !== null) {
    return staffNotesFailed(denied.message, denied.errorCode, denied.requestId);
  }

  const resource = readResource(formData);
  if (resource === null) {
    return staffNotesRejected("Kayıt kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  const body = readBody(formData);
  if (!body.ok) return body.state;

  try {
    await createStaffNote(
      await getKoalaAccessToken(),
      resource.resourceType,
      resource.resourceId,
      body.body,
    );
  } catch (error) {
    return failureFrom(error, "Not kaydedilemedi.");
  }

  revalidateKnown(resource.resourceType, resource.resourceId);
  return staffNotesSucceeded("Not kaydedildi. Denetim kaydına da yazıldı.");
}

export async function submitStaffNoteEdit(
  _state: StaffNotesFormState,
  formData: FormData,
): Promise<StaffNotesFormState> {
  const denied = await guardDecision("note.write");
  if (denied !== null) {
    return staffNotesFailed(denied.message, denied.errorCode, denied.requestId);
  }

  const noteId = field(formData, STAFF_NOTES_FIELD.noteId).trim();
  const resource = readResource(formData);
  if (noteId === "" || resource === null) {
    return staffNotesRejected("Not kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  const body = readBody(formData);
  if (!body.ok) return body.state;

  try {
    await updateStaffNote(await getKoalaAccessToken(), noteId, body.body);
  } catch (error) {
    return failureFrom(error, "Not güncellenemedi.");
  }

  revalidateKnown(resource.resourceType, resource.resourceId);
  return staffNotesSucceeded("Not güncellendi.");
}

export async function submitStaffNoteDelete(
  _state: StaffNotesFormState,
  formData: FormData,
): Promise<StaffNotesFormState> {
  const denied = await guardDecision("note.write");
  if (denied !== null) {
    return staffNotesFailed(denied.message, denied.errorCode, denied.requestId);
  }

  const noteId = field(formData, STAFF_NOTES_FIELD.noteId).trim();
  const resource = readResource(formData);
  if (noteId === "" || resource === null) {
    return staffNotesRejected("Not kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }

  try {
    await deleteStaffNote(await getKoalaAccessToken(), noteId);
  } catch (error) {
    return failureFrom(error, "Not silinemedi.");
  }

  revalidateKnown(resource.resourceType, resource.resourceId);
  return staffNotesSucceeded("Not silindi.");
}

export async function submitStaffFlagSet(
  _state: StaffNotesFormState,
  formData: FormData,
): Promise<StaffNotesFormState> {
  const denied = await guardDecision("flag.manage");
  if (denied !== null) {
    return staffNotesFailed(denied.message, denied.errorCode, denied.requestId);
  }

  const resource = readResource(formData);
  const kind = field(formData, STAFF_NOTES_FIELD.kind).trim();
  if (resource === null) {
    return staffNotesRejected("Kayıt kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }
  if (!isStaffFlagKind(kind)) {
    return staffNotesRejected("Geçerli bir işaret seçin.", "kind");
  }

  const rawLabel = field(formData, STAFF_NOTES_FIELD.label).trim();
  if (rawLabel.length > FLAG_LABEL_MAX_LENGTH) {
    return staffNotesRejected(
      `Etiket en fazla ${FLAG_LABEL_MAX_LENGTH} karakter olabilir.`,
      "label",
    );
  }

  try {
    await setStaffFlag(
      await getKoalaAccessToken(),
      resource.resourceType,
      resource.resourceId,
      kind,
      rawLabel.length === 0 ? null : rawLabel,
    );
  } catch (error) {
    return failureFrom(error, "İşaret konamadı.");
  }

  revalidateKnown(resource.resourceType, resource.resourceId);
  return staffNotesSucceeded("İşaret kaydedildi.");
}

export async function submitStaffFlagClear(
  _state: StaffNotesFormState,
  formData: FormData,
): Promise<StaffNotesFormState> {
  const denied = await guardDecision("flag.manage");
  if (denied !== null) {
    return staffNotesFailed(denied.message, denied.errorCode, denied.requestId);
  }

  const resource = readResource(formData);
  const kind = field(formData, STAFF_NOTES_FIELD.kind).trim();
  if (resource === null) {
    return staffNotesRejected("Kayıt kimliği gelmedi. Sayfayı yenileyip tekrar deneyin.");
  }
  if (!isStaffFlagKind(kind)) {
    return staffNotesRejected("Geçerli bir işaret seçin.", "kind");
  }

  try {
    await clearStaffFlag(
      await getKoalaAccessToken(),
      resource.resourceType,
      resource.resourceId,
      kind,
    );
  } catch (error) {
    return failureFrom(error, "İşaret kaldırılamadı.");
  }

  revalidateKnown(resource.resourceType, resource.resourceId);
  return staffNotesSucceeded("İşaret kaldırıldı.");
}
