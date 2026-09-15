import "server-only";

import { getStaffFlagsByResource, type StaffFlag } from "@/server/api/staff-notes";
import type { StaffResourceType } from "@/lib/staff-notes";
import { getStaffContext } from "@/server/authz/staff-context";

/**
 * Liste rozetleri. `note.read` yoksa istek çıkmaz — finans kolu bu izni
 * taşımaz, kuyruk yine çizilir. Uç düşünce de tablo durur; rozetsiz satır
 * "işaret yok" diye okunmasın diye sessizce boş Map döner, çağıran rozet
 * basmaz.
 */
export async function loadListFlags(
  accessToken: string,
  resourceType: StaffResourceType,
  resourceIds: readonly string[],
): Promise<ReadonlyMap<string, readonly StaffFlag[]>> {
  const context = await getStaffContext();
  if (!context.has("note.read") || resourceIds.length === 0) {
    return new Map();
  }

  try {
    return await getStaffFlagsByResource(accessToken, resourceType, resourceIds);
  } catch {
    return new Map();
  }
}
