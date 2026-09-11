import "server-only";

import { z } from "zod";

import { koalaApi, koalaRequestNoData } from "./koala";

/**
 * Pazaryeri kullanıcı rolleri — `webAPI/AdminController` üç ucu.
 *
 * ```java
 * GET    /admin/users/{userId}/roles           user.read
 * POST   /admin/users/{userId}/roles           user.role.manage  action=user.role.grant
 * DELETE /admin/users/{userId}/roles/{role}    user.role.manage  action=user.role.revoke
 * ```
 *
 * Personel rolleri (`OWNER`, `SUPPORT_AGENT`) değil. `Role.java` yalnız
 * `ROLE_USER` ve `ROLE_ADMIN`. ADR-0014 marketplace `ROLE_ADMIN` köprüsünü
 * kapattı; buradaki `ROLE_ADMIN` hâlâ `users` tablosundaki bir yetki satırı.
 * Personel aktör `granted_by_id`'yi damgalamaz — o kolon `users`'a yabancı
 * anahtar, personelin orada satırı yok — bu yüzden staff yolunda granter
 * boş gelir.
 */

export const MARKETPLACE_ROLES = ["ROLE_USER", "ROLE_ADMIN"] as const;

export type MarketplaceRole = (typeof MARKETPLACE_ROLES)[number];

const marketplaceRoleSchema = z.enum(MARKETPLACE_ROLES);

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/** `core/dtos/user/response/RoleGrantDto.java`. */
export const roleGrantSchema = z.object({
  role: marketplaceRoleSchema,
  grantedAt: nullableString,
  grantedById: nullableString,
  grantedByName: nullableString,
});

export type RoleGrant = z.infer<typeof roleGrantSchema>;

export function isMarketplaceRole(value: string): value is MarketplaceRole {
  return (MARKETPLACE_ROLES as readonly string[]).includes(value);
}

/**
 * Formdan gelen dizeyi rol saymak. Doğrulama `runAuthorizationChange`'de;
 * burada `asRoleCode` ile aynı iddia: boş ya da bozuk değer backend'e gitmeden
 * kapıda durur.
 */
export function asMarketplaceRole(value: string): MarketplaceRole {
  return value as MarketplaceRole;
}

export function marketplaceUserRolesPath(userId: string, role?: string): string {
  const base = `/admin/users/${encodeURIComponent(userId)}/roles`;
  return role === undefined ? base : `${base}/${encodeURIComponent(role)}`;
}

export function getMarketplaceUserRoles(
  accessToken: string,
  userId: string,
): Promise<readonly RoleGrant[]> {
  return koalaApi.get({
    path: marketplaceUserRolesPath(userId),
    schema: z.array(roleGrantSchema),
    accessToken,
    cache: "no-store",
  });
}

export function grantMarketplaceUserRole(
  accessToken: string,
  userId: string,
  role: MarketplaceRole,
): Promise<readonly RoleGrant[]> {
  return koalaApi.post({
    path: marketplaceUserRolesPath(userId),
    schema: z.array(roleGrantSchema),
    body: { role },
    accessToken,
    cache: "no-store",
  });
}

export function revokeMarketplaceUserRole(
  accessToken: string,
  userId: string,
  role: MarketplaceRole,
): Promise<unknown> {
  return koalaRequestNoData({
    path: marketplaceUserRolesPath(userId, role),
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}
