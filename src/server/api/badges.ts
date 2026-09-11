import "server-only";

import { z } from "zod";

import { BADGE_FAMILIES, BADGE_RULE_TYPES, BADGE_TIERS, type BadgeWrite } from "@/lib/badges";

import { koalaApi } from "./koala";

export const BADGES_PATH = "/admin/badges";

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableInt = z
  .number()
  .int()
  .nullish()
  .transform((value) => value ?? null);

const nullableRating = z
  .union([z.number(), z.string()])
  .nullish()
  .transform((value) => {
    if (value === null || value === undefined || value === "") return null;
    const parsed = typeof value === "number" ? value : Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  });

/** `core/dtos/badge/response/BadgeAdminDto.java` */
export const badgeAdminSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  family: z.enum(BADGE_FAMILIES),
  tier: z.enum(BADGE_TIERS),
  name: z.string(),
  description: nullableString,
  iconUrl: nullableString,
  sortOrder: z.number().int(),
  ruleType: z.enum(BADGE_RULE_TYPES),
  minCount: nullableInt,
  minAverageRating: nullableRating,
  minReviewCount: nullableInt,
  active: z.boolean(),
});

const badgeAdminListSchema = z.array(badgeAdminSchema);

export type AdminBadge = z.infer<typeof badgeAdminSchema>;

/** Personel kataloğu, pasifler dahil. Backend kapısı: `badge.manage`. */
export function getManagedBadges(accessToken: string): Promise<AdminBadge[]> {
  return koalaApi.get({
    path: BADGES_PATH,
    schema: badgeAdminListSchema,
    accessToken,
    cache: "no-store",
  });
}

/** `POST /admin/badges` — audited as `badge.create`. */
export function createBadge(accessToken: string, input: BadgeWrite): Promise<AdminBadge> {
  return koalaApi.post({
    path: BADGES_PATH,
    schema: badgeAdminSchema,
    body: input,
    accessToken,
    cache: "no-store",
  });
}

/** `PUT /admin/badges/{id}` — audited as `badge.update`. Kod uçta değişmez. */
export function updateBadge(
  accessToken: string,
  badgeId: string,
  input: BadgeWrite,
): Promise<AdminBadge> {
  return koalaApi.put({
    path: `${BADGES_PATH}/${encodeURIComponent(badgeId)}`,
    schema: badgeAdminSchema,
    body: input,
    accessToken,
    cache: "no-store",
  });
}

/** `PUT /admin/badges/{id}/icon` — part adı `icon`. Audited as `badge.icon.set`. */
export function setBadgeIcon(
  accessToken: string,
  badgeId: string,
  icon: Blob,
): Promise<AdminBadge> {
  const body = new FormData();
  const fileName = icon instanceof File && icon.name.length > 0 ? icon.name : "icon";
  body.set("icon", icon, fileName);
  return koalaApi.put({
    path: `${BADGES_PATH}/${encodeURIComponent(badgeId)}/icon`,
    schema: badgeAdminSchema,
    body,
    accessToken,
    cache: "no-store",
  });
}

/** `POST /admin/badges/{id}/activation?active=` — audited as `badge.activation.set`. */
export function setBadgeActive(
  accessToken: string,
  badgeId: string,
  active: boolean,
): Promise<AdminBadge> {
  return koalaApi.post({
    path: `${BADGES_PATH}/${encodeURIComponent(badgeId)}/activation`,
    schema: badgeAdminSchema,
    query: { active },
    accessToken,
    cache: "no-store",
  });
}
