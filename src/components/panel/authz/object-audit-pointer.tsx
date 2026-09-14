import type { ReactNode } from "react";

import { getStaffContext } from "@/server/authz/staff-context";

import { AuditPointer } from "./audit-pointer";

/**
 * Nesne sayfalarının denetim izi (koala-admin#99): yalnız `resourceId` süzer
 * ve yalnız `audit.read` olana çizilir. İzni olmayana verilen bağlantı onu
 * 403 ekranına götürürdü; ilan ve ödeme bağlantıları da aynı kurala uyar.
 *
 * `getStaffContext` istek kapsamında memo'ludur: sayfanın kendi çağrısıyla
 * aynı `/admin/me` cevabı paylaşılır, ikinci istek çıkmaz.
 */
export async function ObjectAuditPointer({
  resourceId,
  linkLabel,
  children,
}: {
  resourceId: string;
  linkLabel: string;
  children: ReactNode;
}) {
  const context = await getStaffContext();
  if (!context.has("audit.read")) return null;
  return (
    <AuditPointer resourceId={resourceId} linkLabel={linkLabel}>
      {children}
    </AuditPointer>
  );
}
