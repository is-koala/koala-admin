import type { Route } from "next";

import {
  accountDeletionHref,
  assignmentHref,
  companyHref,
  disputeHref,
  ibanVerificationHref,
  identityReviewHref,
  isUuid,
  jobHref,
  paymentHref,
  payoutHref,
  reportHref,
  staffMemberHref,
  userHref,
} from "@/lib/panel-href";
import type { Permission } from "@/server/authz/permissions";

/**
 * Client Component'ler `@/server/**`'dan hiçbir şey — tip bile — import
 * etmez (`no-client-secrets.test.ts` metinsel bakar); denetim tablosu izin
 * adını bu takma addan alır.
 */
export type { Permission as AuditLinkPermission };

/**
 * Denetim satırından nesneye ve personele giden bağlantılar (koala-admin#107).
 *
 * Backend `resourceType`'ı yol kalıbının `/admin/` sonrası ilk parçasından
 * üretir (`AuditScope.resourceTypeOf`): `users`, `job-assignments`,
 * `companies`... Bu tablo o parçaları panelin nesne sayfalarına çevirir.
 * Bilinmeyen parça bağlantısızdır — satır yine çizilir, kimlik düz metin.
 *
 * Bağlantı yalnız hedef sayfanın izni varken verilir: `audit.read` taşıyan
 * biri `user.read` taşımıyorsa kullanıcı sayfasına giden bağlantı onu 403
 * ekranına götürürdü. İzin listesi çağırandan gelir, bu dosya ağ bilmez.
 */

interface ResourceTarget {
  readonly permission: Permission;
  readonly href: (resourceId: string) => Route;
  /** Kimlik UUID olmalı mı; IBAN doğrulaması referansla adreslenir. */
  readonly uuid: boolean;
}

const RESOURCE_TARGETS: Readonly<Record<string, ResourceTarget>> = {
  users: { permission: "user.read", href: userHref, uuid: true },
  "job-assignments": { permission: "payment.read", href: assignmentHref, uuid: true },
  payments: { permission: "payment.read", href: paymentHref, uuid: true },
  payouts: { permission: "payout.reconcile", href: payoutHref, uuid: true },
  companies: { permission: "company.approve", href: (id) => companyHref(id), uuid: true },
  disputes: { permission: "dispute.resolve", href: disputeHref, uuid: true },
  jobs: { permission: "job.read", href: jobHref, uuid: true },
  reports: { permission: "content.moderate", href: reportHref, uuid: true },
  "identity-verifications": {
    permission: "identity.review",
    href: (id) => identityReviewHref(id),
    uuid: true,
  },
  "account-deletions": {
    permission: "user.read_pii",
    href: (id) => accountDeletionHref(id),
    uuid: true,
  },
  "bank-account-verifications": {
    permission: "bank.account.verify",
    href: ibanVerificationHref,
    uuid: false,
  },
  staff: { permission: "staff.read", href: staffMemberHref, uuid: true },
};

export function auditResourceHref(
  resourceType: string,
  resourceId: string,
  held: ReadonlySet<Permission>,
): Route | null {
  if (resourceId.length === 0) return null;
  const target = RESOURCE_TARGETS[resourceType];
  if (target === undefined || !held.has(target.permission)) return null;
  if (target.uuid && !isUuid(resourceId)) return null;
  return target.href(resourceId);
}

export function auditActorHref(
  actorStaffId: string | null,
  held: ReadonlySet<Permission>,
): Route | null {
  if (actorStaffId === null || !isUuid(actorStaffId) || !held.has("staff.read")) return null;
  return staffMemberHref(actorStaffId);
}
