import "server-only";

import { z } from "zod";

import { koalaApi } from "@/server/api/koala";

import { isPermission, type Permission } from "./permissions";

/**
 * The `GET /admin/me` contract, and the only module that knows it exists.
 *
 * koala-admin#5 asks for the backend contract to sit behind a single module so
 * that stubbing it, and later un-stubbing it, touches one file. This is that
 * file: `staff-context.ts` above it deals in a resolved permission list and has
 * no idea what the wire format looks like.
 *
 * Verified shape (koala-backend#14, response captured on the endpoint):
 *
 * ```json
 * {
 *   "success": true,
 *   "message": "Personel kimliği çözüldü.",
 *   "httpStatus": "200 OK",
 *   "path": "/admin/me",
 *   "requestId": "…",
 *   "timeStamp": "…",
 *   "data": {
 *     "staffId": "…", "displayName": "Trust Lideri", "email": "…",
 *     "roles": ["DISPUTE_HANDLER", "MODERATOR", "SUPPORT_AGENT", "TRUST_LEAD"],
 *     "permissions": ["content.moderate", "dispute.resolve", "user.read", "user.read_pii"]
 *   }
 * }
 * ```
 *
 * A **403** with `errorCategory: "ACCESS_DENIED"` is not only "no staff row":
 * since ADR-0014 the backend answers the same way while an account carries the
 * "change your password first" flag, because `StaffPermissionAuthorizationManager`
 * denies every `@RequiresPermission` endpoint — this one included — until it is
 * cleared. `src/server/auth/session.ts` stops the common case a request earlier,
 * but only from an unsigned cookie, so a 403 can still arrive here for either
 * reason; `staff-context.ts` asks the backend which one it is rather than
 * assuming.
 */

export const ADMIN_ME_PATH = "/admin/me";

/**
 * `roles` is informational only.
 *
 * It arrives with transitively-included roles already resolved, and both arrays
 * arrive sorted. The panel prints it as evidence of who the backend thinks you
 * are; it never turns it into a permission. That conversion is the backend's,
 * per ADR-0010, and doing it here would be the staleness the ADR rejects.
 */
export const adminMeSchema = z.object({
  staffId: z.string().min(1),
  displayName: z.string(),
  email: z.string(),
  roles: z.array(z.string()),
  permissions: z.array(z.string()),
});

export type AdminMePayload = z.infer<typeof adminMeSchema>;

export interface StaffIdentity {
  readonly staffId: string;
  readonly displayName: string;
  readonly email: string;
  /** Backend-resolved role membership, including transitively included roles. */
  readonly roles: readonly string[];
  /** Permission names this panel version knows. */
  readonly permissions: readonly Permission[];
  /**
   * Permission names the backend granted that this panel version has never
   * heard of. Kept rather than dropped so the mismatch is visible in a log
   * instead of looking like a permission that quietly does nothing.
   */
  readonly unknownPermissions: readonly string[];
}

/**
 * Split the backend's permission list into what the panel understands and what
 * it does not.
 *
 * Why not `z.enum(PERMISSIONS)` in the schema: a seventeenth permission would
 * then fail the whole response, `getStaffContext()` would fail closed, and
 * every operator's menu would empty the moment the backend shipped ahead of the
 * panel. Unknown names are ignored — they map to no gate and no menu entry, so
 * ignoring them denies nothing that was previously allowed — while the known
 * ones keep working.
 */
export function partitionPermissions(names: readonly string[]): {
  known: Permission[];
  unknown: string[];
} {
  const known: Permission[] = [];
  const unknown: string[] = [];

  for (const name of names) {
    if (isPermission(name)) {
      // The backend sorts, but a duplicate would silently double a menu entry.
      if (!known.includes(name)) known.push(name);
    } else if (!unknown.includes(name)) {
      unknown.push(name);
    }
  }

  return { known, unknown };
}

/**
 * Ask the backend who this token belongs to and what it may do.
 *
 * Throws `KoalaApiError` like every other call in `src/server/api` — deciding
 * what a 403 or a 500 means for the page is `staff-context.ts`'s job, and it
 * has to distinguish them.
 */
export async function fetchAdminMe(accessToken: string): Promise<StaffIdentity> {
  const payload = await koalaApi.get({
    path: ADMIN_ME_PATH,
    schema: adminMeSchema,
    accessToken,
    /**
     * Never cached. ADR-0010's whole argument is that a revoked permission has
     * to stop working now rather than when something expires; a cached
     * `/admin/me` would reintroduce exactly the staleness the ADR moved out of
     * the token. De-duplication within one render is React `cache()`'s job in
     * `staff-context.ts`, and that lives and dies with the request.
     */
    cache: "no-store",
  });

  const { known, unknown } = partitionPermissions(payload.permissions);

  return {
    staffId: payload.staffId,
    displayName: payload.displayName,
    email: payload.email,
    roles: payload.roles,
    permissions: known,
    unknownPermissions: unknown,
  };
}
