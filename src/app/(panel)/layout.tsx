import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { StaffContextUnavailable } from "@/components/panel/access-states";
import { PanelShell } from "@/components/panel/panel-shell";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";
import { signOut } from "@/server/auth/actions";
import { navigationFor } from "@/server/authz/routes";
import { getStaffContext } from "@/server/authz/staff-context";

/**
 * The panel shell — everything behind the session gate except the two sign-in
 * surfaces, which sit outside this route group so they can be reached without
 * one.
 *
 * The menu is drawn here, from `getStaffContext()`, which asks the backend on
 * every request. The layout and whichever page renders below it both call it
 * and React's `cache()` collapses that into one `GET /admin/me` — so putting
 * the menu in the layout costs nothing and keeps a single answer behind the
 * whole render.
 *
 * `navigationFor(context.permissions)` is the only permission→menu mapping in
 * the codebase, and it takes a list rather than reading one, so a failed
 * resolution arrives as `[]` and empties the menu with no special case. A 500
 * from `/admin/me` produces no menu at all rather than the entries that
 * happened to be safe to draw.
 */
/**
 * Nothing under this shell may be prerendered. Every page here resolves
 * permissions per request, and a build-time snapshot would either bake one
 * person's menu into the HTML or need the backend reachable during
 * `next build`. `cookies()` already forces this; saying it is cheaper than
 * discovering it.
 */
export const dynamic = "force-dynamic";

export default async function PanelLayout({ children }: { children: ReactNode }) {
  const context = await getStaffContext();
  const entries = navigationFor(context.permissions);
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <PanelShell
      staff={
        context.staff === null
          ? null
          : { displayName: context.staff.displayName, email: context.staff.email }
      }
      entries={entries}
      unresolved={context.failure !== null}
      initialTheme={theme}
      signOut={signOut}
    >
      {/*
       * Shown above the page rather than instead of it. The person whose
       * permissions could not be resolved still sees where they are and can
       * still sign out; what they do not see is a menu implying doors that
       * were never checked.
       *
       * Every failure, including the session ones. A gated page redirects
       * those to /giris or /giris/hata, but an ungated page has nothing to
       * redirect and would otherwise show an empty menu with no reason
       * attached to it.
       */}
      {context.failure === null ? null : <StaffContextUnavailable failure={context.failure} />}
      {children}
    </PanelShell>
  );
}
