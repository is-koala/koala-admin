import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";

/**
 * Reference data — the public, unauthenticated corner of the backend
 * (`webAPI/ReferenceDataController.java`, `@RequestMapping("/reference")`,
 * permitted by `SecurityConfig.java:128` with
 * `.requestMatchers(HttpMethod.GET, "/reference/**").permitAll()`).
 *
 * This slice deliberately touches nothing else: `/admin/**` still sits behind a
 * single flat `hasRole("ADMIN")` door and moves to its own filter chain in
 * koala-backend#14.
 */

/** `core/dtos/jobCategory/response/JobCategoryDto.java` */
export const jobCategorySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /**
   * Stable, name-independent identifier. Map icons, pins and colours to this —
   * never to the UUID or the display name.
   */
  code: z.string(),
  requiresInsurance: z.boolean(),
});

export type JobCategory = z.infer<typeof jobCategorySchema>;

const jobCategoryListSchema = z.array(jobCategorySchema);

/** `GET /reference/job-categories` — no authentication required. */
export function getJobCategories(): Promise<JobCategory[]> {
  return koalaApi.get({
    path: "/reference/job-categories",
    schema: jobCategoryListSchema,
    // Reference data is small and the panel manages the same catalogue; never
    // serve a stale list to an operator who just changed it.
    cache: "no-store",
  });
}
