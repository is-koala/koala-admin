import "server-only";

import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PermissionDenied, StaffContextUnavailable } from "@/components/panel/access-states";
import type { AuthFailureCode } from "@/server/auth/errors";

import type { Permission } from "./permissions";
import { getStaffContext } from "./staff-context";

/**
 * The server-side gate.
 *
 * What makes it a gate rather than a curtain: when the permission is missing
 * this component returns a different tree, so `children` is never rendered.
 * JSX only *describes* the child — `<AuditLogTable />` is an element, not a
 * call — so the component function never runs, its `await` never happens, and
 * the audit request is never made. Nothing is fetched and then hidden, and
 * nothing is hidden with CSS. `gate.test.tsx` asserts the request count is
 * zero, which is the only form of that claim worth making.
 *
 * The one thing it cannot do is decide the answer. `@RequiresPermission` on
 * the backend is the authority; this gate exists so a person gets an
 * explanation instead of a 403-shaped hole, and so the panel does not spend a
 * request asking a question it can already tell will be refused.
 *
 * Note it renders a 403 *state* rather than sending HTTP 403: the only way an
 * App Router page can set that status is `forbidden()`, which needs the
 * experimental `authInterrupts` flag. Keeping the panel shell and saying which
 * permission is missing is worth more here than the status line, and turning on
 * an experimental flag for a slice-1 gate is not a trade worth making.
 */
export interface RequirePermissionProps {
  /**
   * Written as a literal at every call site on purpose: `routes.test.ts` reads
   * the page source and checks it against the route registry, so a page whose
   * gate drifts from its registry entry fails the build.
   */
  permission: Permission;
  children: ReactNode;
}

export async function RequirePermission({ permission, children }: RequirePermissionProps) {
  const context = await getStaffContext();

  if (context.failure !== null) {
    if (context.failure.authCode !== null) {
      redirectForAuthFailure(context.failure.authCode);
    }

    // Fail closed, and say which kind of closed. Not "you lack permission":
    // the panel does not know that, and claiming it would send someone to ask
    // for roles they already hold.
    return <StaffContextUnavailable failure={context.failure} />;
  }

  if (!context.has(permission)) {
    return <PermissionDenied permission={permission} roles={context.staff?.roles ?? []} />;
  }

  return <>{children}</>;
}

/**
 * Hand a broken session back to the pages that already explain it.
 *
 * `/giris/hata` distinguishes a dead session from a switched-off audience
 * mapper from an unreachable Keycloak, in those words. Rewriting any of that
 * here would mean two places to keep right.
 */
function redirectForAuthFailure(code: AuthFailureCode): never {
  if (code === "SESSION_REQUIRED") {
    redirect("/giris");
  }

  redirect(`/giris/hata?kod=${encodeURIComponent(code)}`);
}
