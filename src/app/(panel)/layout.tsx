import Link from "next/link";
import type { ReactNode } from "react";

import { StaffContextUnavailable } from "@/components/panel/access-states";
import { StaffNav } from "@/components/panel/staff-nav";
import { signOutFromKeycloak } from "@/server/auth/actions";
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

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col gap-6 px-6 py-8 md:flex-row md:gap-10 md:py-12">
      <aside className="flex w-full shrink-0 flex-col gap-6 md:w-60">
        <Link href="/" className="text-sm font-semibold text-ink">
          Koala Yönetim Paneli
        </Link>

        <StaffNav entries={entries} unresolved={context.failure !== null} />

        <div className="mt-auto flex flex-col gap-2 border-t border-border-subtle pt-4">
          {context.staff === null ? null : (
            <div className="flex flex-col">
              <span className="text-sm text-ink">{context.staff.displayName}</span>
              <span className="text-xs text-ink-muted">{context.staff.email}</span>
            </div>
          )}
          <form action={signOutFromKeycloak}>
            <button
              type="submit"
              className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
            >
              Çıkış yap
            </button>
          </form>
        </div>
      </aside>

      <main className="flex min-w-0 flex-1 flex-col gap-6">
        {/*
         * Shown above the page rather than instead of it. The person whose
         * permissions could not be resolved still sees where they are and can
         * still sign out; what they do not see is a menu implying doors that
         * were never checked.
         */}
        {context.failure !== null && context.failure.authCode === null ? (
          <StaffContextUnavailable failure={context.failure} />
        ) : null}
        {children}
      </main>
    </div>
  );
}
