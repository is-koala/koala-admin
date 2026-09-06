import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * The audit log — the panel's `audit.read` surface.
 *
 * **This contract is provisional and says so.** koala-backend#14 seeds
 * `audit.read` but no endpoint claims it yet, and koala-admin#5's second
 * comment records that deliberately. The shape below is the panel's proposal,
 * not a captured response, and the module exists so that:
 *
 *  - the gate on `/audit-log` has something real to withhold — a page that
 *    fetched nothing could not demonstrate that nothing is fetched;
 *  - when the endpoint lands, one file changes.
 *
 * Until then the backend answers **403**, not 404: an unmapped `/admin/...`
 * path is refused by #14's fail-closed default. The page renders that refusal
 * as the backend's verdict, which is the behaviour the panel needs anyway —
 * the UI gate is a courtesy and `@RequiresPermission` is the authority.
 */

export const AUDIT_LOG_PATH = "/admin/audit-log";

export const auditLogEntrySchema = z.object({
  id: z.string(),
  /** Staff member who acted, as the backend resolved them. */
  actor: z.string(),
  /** Permission-shaped action name, e.g. `payout.release`. */
  action: z.string(),
  resource: z.string().nullish().default(null),
  resourceId: z.string().nullish().default(null),
  /** ISO-8601 instant, UTC. */
  at: z.string(),
});

export type AuditLogEntry = z.infer<typeof auditLogEntrySchema>;

export interface AuditLogQuery {
  /** Zero-based, like `PageDto`. */
  page?: number;
  size?: number;
}

/**
 * `accessToken` is a parameter rather than something this module fetches for
 * itself: `getKoalaAccessToken()` is the single seam issue #4 built, and a data
 * module that reached for a token on its own would be a second one.
 */
export function getAuditLog(
  accessToken: string,
  query: AuditLogQuery = {},
): Promise<PageDto<AuditLogEntry>> {
  return koalaApi.get({
    path: AUDIT_LOG_PATH,
    schema: pageDtoSchema(auditLogEntrySchema),
    query: { page: query.page ?? 0, size: query.size ?? 25 },
    accessToken,
    cache: "no-store",
  });
}
