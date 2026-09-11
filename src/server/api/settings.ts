import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";

export const SETTINGS_PATH = "/admin/settings";

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

export const settingSchema = z.object({
  key: z.string(),
  value: z.string(),
  description: nullableString,
  updatedAt: nullableString,
});

const settingListSchema = z.array(settingSchema);

export type Setting = z.infer<typeof settingSchema>;

/** The staff view of policy numbers, guarded by `settings.manage` on the backend. */
export function getRuntimeSettings(accessToken: string): Promise<Setting[]> {
  return koalaApi.get({
    path: SETTINGS_PATH,
    schema: settingListSchema,
    accessToken,
    cache: "no-store",
  });
}

/** `PUT /admin/settings/{key}` — audited by the backend as `setting.update`. */
export function updateRuntimeSetting(
  accessToken: string,
  key: string,
  value: string,
): Promise<Setting> {
  return koalaApi.put({
    path: `${SETTINGS_PATH}/${encodeURIComponent(key)}`,
    schema: settingSchema,
    body: { value },
    accessToken,
    cache: "no-store",
  });
}
