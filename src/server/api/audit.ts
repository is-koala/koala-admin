import "server-only";

import { z } from "zod";

import { auditLogQuery, type AuditEntry, type AuditLogRequest } from "@/lib/audit-log";
import { PERMISSION_SENSITIVITIES } from "@/server/authz/permissions";

import { koalaApi } from "./koala";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * `GET /admin/audit-log` — the panel's `audit.read` surface.
 *
 * Slice 1 shipped a placeholder here and said so: koala-backend#14 seeded the
 * `audit.read` permission with no endpoint behind it, so the module existed
 * only to give the gate something real to withhold. This is the version with
 * the contract in it (koala-backend#15), and the shape is no longer a guess
 * about *what* is recorded — it is a guess about nothing except the wire format
 * of `from`/`to`, which is called out where it is made.
 *
 * The one structural thing worth reading twice is the split between the core
 * fields and the detail fields. koala-backend#15 keeps them in two tables with
 * two retention clocks — 24 months for the core (10 years when the permission
 * is financial), 6 months or a KVKK erasure request for the detail. So:
 *
 *  - core fields are non-nullable and the schema treats a missing one as a
 *    contract violation, because a row that cannot say who did what is not a
 *    weaker audit record, it is not one. The single exception is
 *    `actorStaffId`: koala-backend#15 leaves it null for a valid staff token
 *    with no `staff_members` row, and for the ADR-0010 bridge-phase
 *    marketplace admin. Those rows are the ones most worth reading, so a
 *    strict schema here would blank the whole page over exactly them.
 *    `actorDisplayName` is always present and carries the Keycloak subject in
 *    that case;
 *  - detail fields are nullable and a null is **not** an error. It is the
 *    erasure having happened. Anything rendering them has to say so out loud
 *    rather than draw an empty box.
 *
 * Filtering is a server concern and there is no code path here that receives a
 * page and narrows it — see `src/lib/audit-log.ts`.
 */

export const AUDIT_LOG_PATH = "/admin/audit-log";

/**
 * `requestBody`, `before` and `after` are JSON snapshots, and the backend may
 * hand them over as a string or as an already-parsed object depending on how
 * the `jsonb` column is mapped. Both are accepted and normalised to text: these
 * fields are shown to a human and never branched on, so a strict shape would
 * buy nothing and would fail the whole page over a display field.
 */
function toSnapshotText(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.length === 0 ? null : value;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    /* v8 ignore next 2 -- a circular JSON body cannot arrive over the wire. */
    return String(value);
  }
}

const snapshotSchema = z.unknown().transform(toSnapshotText);

const nullableTextSchema = z
  .string()
  .nullish()
  .transform((value) => (value === null || value === undefined || value === "" ? null : value));

/**
 * Typed as `z.ZodType<AuditEntry>` on purpose: the interface lives in
 * `src/lib/audit-log.ts` so a Client Component can name it, and this annotation
 * is what stops the schema and the interface drifting apart.
 */
export const auditEntrySchema: z.ZodType<AuditEntry> = z.object({
  id: z.string(),
  occurredAt: z.string(),
  actorStaffId: z.string().nullable(),
  actorDisplayName: z.string(),
  /**
   * Deliberately `string`, not the narrowed `Permission` union. The backend
   * writes whatever its interceptor checked; the day koala-backend adds a
   * seventeenth permission, this page must still render the row rather than
   * blank the whole table over an unknown name. The panel looks the label up
   * when it recognises it and prints the raw name either way.
   */
  permission: z.string(),
  action: z.string(),
  resourceType: z.string(),
  resourceId: z.string(),
  allowed: z.boolean(),
  mutating: z.boolean(),
  sensitivity: z.enum(PERMISSION_SENSITIVITIES),

  requestBody: snapshotSchema,
  ip: nullableTextSchema,
  userAgent: nullableTextSchema,
  before: snapshotSchema,
  after: snapshotSchema,
});

/**
 * `accessToken` is a parameter rather than something this module fetches for
 * itself: `getKoalaAccessToken()` is the single seam issue #4 built, and a data
 * module that reached for a token on its own would be a second one.
 *
 * `cache: "no-store"` for the same reason the page has no polling: this read is
 * itself an audited event, and a cached one would show an operator a table that
 * disagrees with the record they are checking.
 */
export function getAuditLog(
  accessToken: string,
  request: AuditLogRequest,
): Promise<PageDto<AuditEntry>> {
  return koalaApi.get({
    path: AUDIT_LOG_PATH,
    schema: pageDtoSchema(auditEntrySchema),
    query: auditLogQuery(request),
    accessToken,
    cache: "no-store",
  });
}
