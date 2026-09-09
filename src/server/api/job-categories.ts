import "server-only";

import { z } from "zod";

import { koalaApi, koalaRequestNoData } from "./koala";
import { jobCategorySchema, type JobCategory } from "./reference";
import type { KoalaResultMeta } from "./types";

export const JOB_CATEGORIES_PATH = "/admin/job-categories";

const jobCategoryListSchema = z.array(jobCategorySchema);

export interface JobCategoryInput {
  readonly code: string;
  readonly name: string;
  readonly requiresInsurance: boolean;
}

/** The staff view of the catalogue, guarded by `category.manage` on the backend. */
export function getManagedJobCategories(accessToken: string): Promise<JobCategory[]> {
  return koalaApi.get({
    path: JOB_CATEGORIES_PATH,
    schema: jobCategoryListSchema,
    accessToken,
    cache: "no-store",
  });
}

/** `POST /admin/job-categories` — audited by the backend as `job.category.create`. */
export function createJobCategory(
  accessToken: string,
  input: JobCategoryInput,
): Promise<JobCategory> {
  return koalaApi.post({
    path: JOB_CATEGORIES_PATH,
    schema: jobCategorySchema,
    body: input,
    accessToken,
    cache: "no-store",
  });
}

/** `PUT /admin/job-categories/{id}` — audited as `job.category.update`. */
export function updateJobCategory(
  accessToken: string,
  categoryId: string,
  input: JobCategoryInput,
): Promise<JobCategory> {
  return koalaApi.put({
    path: `${JOB_CATEGORIES_PATH}/${encodeURIComponent(categoryId)}`,
    schema: jobCategorySchema,
    body: input,
    accessToken,
    cache: "no-store",
  });
}

/** `DELETE /admin/job-categories/{id}` — audited as `job.category.delete`. */
export function deleteJobCategory(
  accessToken: string,
  categoryId: string,
): Promise<KoalaResultMeta> {
  return koalaRequestNoData({
    path: `${JOB_CATEGORIES_PATH}/${encodeURIComponent(categoryId)}`,
    method: "DELETE",
    accessToken,
    cache: "no-store",
  });
}

export type { JobCategory };
