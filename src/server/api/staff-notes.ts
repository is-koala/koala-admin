import "server-only";

import { z } from "zod";

import {
  FLAG_BATCH_MAX,
  groupFlagsByResourceId,
  isStaffFlagKind,
  isStaffResourceType,
  type StaffFlagKind,
  type StaffResourceType,
} from "@/lib/staff-notes";

import { koalaApi, koalaRequestNoData } from "./koala";
import { firstPage, pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * Personel notları ve işaretleri — `StaffNotesController` / `StaffFlagsController`.
 *
 * ```
 * GET    /admin/notes?resourceType&resourceId   note.read
 * POST   /admin/notes?resourceType&resourceId   note.write
 * PATCH  /admin/notes/{noteId}                  note.write
 * DELETE /admin/notes/{noteId}                  note.write
 * GET    /admin/flags?resourceType&resourceId   note.read
 * GET    /admin/flags?resourceType&resourceIds  note.read
 * PUT    /admin/flags?resourceType&resourceId   flag.manage
 * DELETE /admin/flags?resourceType&resourceId&kind  flag.manage
 * ```
 *
 * Yazımlar BFF'den çıkar; tarayıcı `api.iskoala.com`'a gitmez. Denetim satırını
 * backend yazar — panelin işi o ucu atlamamak.
 */

export const NOTES_PATH = "/admin/notes";
export const FLAGS_PATH = "/admin/flags";

/** `StaffNoteManager.SORTABLE` — başka alan 400. */
export const NOTE_PAGING: PagingContract = {
  sortable: ["createdAt"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/**
 * `StaffNoteDto`. `resourceType` `z.string()`: yeni bir kaynak türü bütün
 * not sayfasını şema hatasına çevirmesin. Gönderirken kapalı küme.
 */
export const staffNoteSchema = z.object({
  id: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  authorStaffId: z.string(),
  authorDisplayName: nullableString,
  body: z.string(),
  createdAt: nullableString,
  editedAt: nullableString,
});

export type StaffNote = z.infer<typeof staffNoteSchema>;

/** `StaffFlagDto`. `kind` gevşek: yeni bir işaret türü rozeti düşürmesin. */
export const staffFlagSchema = z.object({
  id: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  kind: z.string(),
  label: nullableString,
  setByStaffId: nullableString,
  setByDisplayName: nullableString,
  setAt: nullableString,
  clearedAt: nullableString,
});

export type StaffFlag = z.infer<typeof staffFlagSchema>;

export function notePath(noteId: string): string {
  return `${NOTES_PATH}/${encodeURIComponent(noteId)}`;
}

export function getStaffNotes(
  accessToken: string,
  resourceType: StaffResourceType,
  resourceId: string,
  paging: Paging = firstPage(NOTE_PAGING, 20),
): Promise<PageDto<StaffNote>> {
  return koalaApi.get({
    path: NOTES_PATH,
    query: { resourceType, resourceId, ...pagingQuery(paging) },
    schema: pageDtoSchema(staffNoteSchema),
    accessToken,
    cache: "no-store",
  });
}

export function createStaffNote(
  accessToken: string,
  resourceType: StaffResourceType,
  resourceId: string,
  body: string,
): Promise<StaffNote> {
  return koalaApi.post({
    path: NOTES_PATH,
    query: { resourceType, resourceId },
    body: { body },
    schema: staffNoteSchema,
    accessToken,
    cache: "no-store",
  });
}

export function updateStaffNote(
  accessToken: string,
  noteId: string,
  body: string,
): Promise<StaffNote> {
  return koalaApi.patch({
    path: notePath(noteId),
    body: { body },
    schema: staffNoteSchema,
    accessToken,
    cache: "no-store",
  });
}

export function deleteStaffNote(accessToken: string, noteId: string): Promise<unknown> {
  return koalaRequestNoData({
    path: notePath(noteId),
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}

export interface StaffFlagLookup {
  readonly resourceType: StaffResourceType;
  readonly resourceId?: string;
  readonly resourceIds?: readonly string[];
}

function flagQuery(lookup: StaffFlagLookup): Record<string, string> {
  const query: Record<string, string> = { resourceType: lookup.resourceType };
  if (lookup.resourceId !== undefined) {
    query.resourceId = lookup.resourceId;
  }
  if (lookup.resourceIds !== undefined && lookup.resourceIds.length > 0) {
    query.resourceIds = lookup.resourceIds.join(",");
  }
  return query;
}

export function getStaffFlags(accessToken: string, lookup: StaffFlagLookup): Promise<StaffFlag[]> {
  return koalaApi.get({
    path: FLAGS_PATH,
    query: flagQuery(lookup),
    schema: z.array(staffFlagSchema),
    accessToken,
    cache: "no-store",
  });
}

/**
 * Liste rozetleri: kimlikleri 200'lük parçalara böler, tek Map döner.
 * Boş liste backend'e çıkmaz — `StaffFlagLookup` en az bir kimlik ister.
 */
export async function getStaffFlagsByResource(
  accessToken: string,
  resourceType: StaffResourceType,
  resourceIds: readonly string[],
): Promise<Map<string, StaffFlag[]>> {
  const unique = [...new Set(resourceIds.filter((id) => id.length > 0))];
  if (unique.length === 0) {
    return new Map();
  }

  const chunks: string[][] = [];
  for (let index = 0; index < unique.length; index += FLAG_BATCH_MAX) {
    chunks.push(unique.slice(index, index + FLAG_BATCH_MAX));
  }

  const pages = await Promise.all(
    chunks.map((chunk) =>
      getStaffFlags(accessToken, {
        resourceType,
        resourceIds: chunk,
      }),
    ),
  );

  return groupFlagsByResourceId(pages.flat());
}

export function setStaffFlag(
  accessToken: string,
  resourceType: StaffResourceType,
  resourceId: string,
  kind: StaffFlagKind,
  label: string | null,
): Promise<StaffFlag> {
  return koalaApi.put({
    path: FLAGS_PATH,
    query: { resourceType, resourceId },
    body: label === null ? { kind } : { kind, label },
    schema: staffFlagSchema,
    accessToken,
    cache: "no-store",
  });
}

export function clearStaffFlag(
  accessToken: string,
  resourceType: StaffResourceType,
  resourceId: string,
  kind: StaffFlagKind,
): Promise<unknown> {
  return koalaRequestNoData({
    path: FLAGS_PATH,
    method: "DELETE",
    query: { resourceType, resourceId, kind },
    accessToken,
    cache: "no-store",
  });
}

export { isStaffFlagKind, isStaffResourceType };
export type { StaffFlagKind, StaffResourceType };
