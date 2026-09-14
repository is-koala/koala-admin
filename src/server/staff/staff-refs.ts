import "server-only";

import type { Route } from "next";

import { isUuid, staffMemberHref } from "@/lib/panel-href";
import { shortId } from "@/lib/short-id";
import { getStaffMember } from "@/server/api/staff-members";
import type { StaffContext } from "@/server/authz/staff-context";

/**
 * Personel kimliği → ad (koala-admin#112).
 *
 * `approvedByStaffId`, `resolvedByStaffId`, `reconciledByStaffId`,
 * `rejectedByStaffId`, `reviewedByStaffId` DTO'larda ham UUID'dir; backend ad
 * eklemiyor (kimlik incelemesi hariç). Panel `GET /admin/staff/{id}` ile
 * sunucu tarafında çözer: sayfa başına bir kez, tekilleştirilmiş ve paralel.
 *
 * Uç `staff.read` ister. İzin yoksa istek hiç çıkmaz — kısa kimlik gösterilir
 * ve bağlantı kurulmaz, çünkü `/staff` da aynı izinle kapalı. İzin varken
 * tek bir personel okunamazsa (silinmiş değil, çünkü personel silinemiyor;
 * ama 403/5xx olabilir) yalnız o satır kısa kimliğe düşer, sayfa düşmez.
 */

export interface StaffRef {
  readonly id: string;
  /** Ad; ad yoksa e-posta; çözülemediyse kısa kimlik. */
  readonly label: string;
  /** `/staff` bağlantısı; `staff.read` yoksa `null`. */
  readonly href: Route | null;
  /** Backend'den okundu mu — kısa kimlik mi, ad mı ayrımı için. */
  readonly resolved: boolean;
}

/** Düz nesne, `Map` değil: Server → Client sınırından geçebilsin. */
export type StaffRefs = Readonly<Record<string, StaffRef>>;

export const NO_STAFF_REFS: StaffRefs = {};

/**
 * Çözülecek bir kimlik; DTO adı zaten veriyorsa (`reviewedByStaffName`) o
 * adla gelir ve ikinci bir istek çıkmaz, bağlantı yine kurulur.
 */
export type StaffRefRequest = string | { readonly id: string; readonly name: string | null };

function unresolved(id: string, canReadStaff: boolean): StaffRef {
  return {
    id,
    label: shortId(id),
    href: canReadStaff && isUuid(id) ? staffMemberHref(id) : null,
    resolved: false,
  };
}

/**
 * Sayfadaki bütün personel kimliklerini tek seferde çözer. `null`/`undefined`
 * ve UUID olmayanlar atlanır; aynı kimlik bir kez istenir.
 */
export async function resolveStaffRefs(
  requests: ReadonlyArray<StaffRefRequest | null | undefined>,
  options: { readonly accessToken: string; readonly context: Pick<StaffContext, "has"> },
): Promise<StaffRefs> {
  const canReadStaff = options.context.has("staff.read");
  const known = new Map<string, string>();
  const unique: string[] = [];
  for (const request of requests) {
    if (request === null || request === undefined) continue;
    const id = typeof request === "string" ? request : request.id;
    if (id.length === 0) continue;
    if (typeof request !== "string" && request.name !== null && request.name.length > 0) {
      known.set(id, request.name);
    }
    if (!unique.includes(id)) unique.push(id);
  }

  const entries = await Promise.all(
    unique.map(async (id): Promise<[string, StaffRef]> => {
      const name = known.get(id);
      if (name !== undefined) {
        return [
          id,
          {
            id,
            label: name,
            href: canReadStaff && isUuid(id) ? staffMemberHref(id) : null,
            resolved: true,
          },
        ];
      }
      if (!canReadStaff || !isUuid(id)) return [id, unresolved(id, canReadStaff)];
      try {
        const member = await getStaffMember(options.accessToken, id);
        return [
          id,
          {
            id,
            label: member.displayName ?? member.email,
            href: staffMemberHref(id, member.email),
            resolved: true,
          },
        ];
      } catch {
        // `koalaRequest` hatayı zaten günlükledi; burada sayfa değil satır düşer.
        return [id, unresolved(id, canReadStaff)];
      }
    }),
  );

  return Object.fromEntries(entries);
}

/** Çözülmüş kümeden bir kimlik; kümede yoksa kısa kimlik, bağlantısız. */
export function staffRefFor(refs: StaffRefs, staffId: string): StaffRef {
  return refs[staffId] ?? { id: staffId, label: shortId(staffId), href: null, resolved: false };
}
