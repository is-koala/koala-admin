import { z } from "zod";

import type { PageDto } from "./types";

/**
 * Runtime schema for `core/dtos/common/PageDto.java`.
 *
 * Wrap the item schema of any paged endpoint:
 *   `schema: pageDtoSchema(jobCategorySchema)`
 */
export function pageDtoSchema<T>(item: z.ZodType<T>): z.ZodType<PageDto<T>> {
  return z.object({
    content: z.array(item),
    page: z.number().int(),
    size: z.number().int(),
    totalElements: z.number(),
    totalPages: z.number().int(),
    first: z.boolean(),
    last: z.boolean(),
  });
}
