import "server-only";

import type { Route } from "next";

import { shortId } from "@/lib/breadcrumb";
import { isUuid, staffMemberHref } from "@/lib/panel-href";
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
  ids: ReadonlyArray<string | null | undefined>,
  options: { readonly accessToken: string; readonly context: Pick<StaffContext, "has"> },
): Promise<StaffRefs> {
  const canReadStaff = options.context.has("staff.read");
  const unique = [
    ...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0)),
  ];

  const entries = await Promise.all(
    unique.map(async (id): Promise<[string, StaffRef]> => {
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
