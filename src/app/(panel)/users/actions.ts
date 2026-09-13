"use server";

import type { AuthorizationChangeOutcome } from "@/lib/authorization-change";
import { asMarketplaceRole } from "@/server/api/marketplace-user-roles";
import { runAuthorizationChange } from "@/server/authz/administration";
import { revalidateAfterWrite } from "@/server/queue/revalidate-after-write";

/**
 * Pazaryeri kullanıcı rollerinin iki yazımı — koala-admin#47.
 *
 * Sayfanın kapısı `user.read`. Bu eylemler `user.role.manage` ister ve o
 * kontrol `runAuthorizationChange`'de: bir Server Action kendi URL'i olan bir
 * POST ucudur, `<RequirePermission>` onun için çalışmaz.
 *
 * Başarıda nesne, liste ve ana ekran yenilenir. Aksi halde nesne eski rolleri
 * çizer ve ana ekran sayıları bayat kalır.
 */

export async function grantMarketplaceRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const outcome = await runAuthorizationChange({
    kind: "USER_ROLE_GRANT",
    userId: text(formData, "userId"),
    userLabel: text(formData, "userLabel"),
    role: asMarketplaceRole(text(formData, "role")),
  });
  return afterWrite(text(formData, "userId"), outcome);
}

export async function revokeMarketplaceRole(
  _state: AuthorizationChangeOutcome,
  formData: FormData,
): Promise<AuthorizationChangeOutcome> {
  const outcome = await runAuthorizationChange({
    kind: "USER_ROLE_REVOKE",
    userId: text(formData, "userId"),
    userLabel: text(formData, "userLabel"),
    role: asMarketplaceRole(text(formData, "role")),
  });
  return afterWrite(text(formData, "userId"), outcome);
}

function afterWrite(
  userId: string,
  outcome: AuthorizationChangeOutcome,
): AuthorizationChangeOutcome {
  if (outcome.status === "SUCCEEDED") {
    revalidateAfterWrite(`/users/${userId}`, "/users", "/");
  }
  return outcome;
}

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "").trim();
}
