import Link from "next/link";

import type { NavEntry } from "@/server/authz/routes";

export interface StaffNavProps {
  /**
   * Already filtered by `navigationFor(permissions)`. This component draws what
   * it is handed and decides nothing — the permission→menu mapping lives in the
   * route registry, in one place, and must not grow a second home here.
   */
  entries: readonly NavEntry[];
  /** True when `/admin/me` could not be resolved, so the emptiness is explained. */
  unresolved?: boolean;
}

/**
 * The menu.
 *
 * An empty `entries` array renders an empty menu, deliberately and without a
 * fallback. Every failure in `getStaffContext()` arrives here as zero entries,
 * so "the backend is down" and "you hold no permissions" look the same in the
 * navigation and different in the message underneath it — which is the right
 * way round: the menu must never suggest a door that is not there.
 *
 * Presentational and synchronous, so a test can render it directly. Nothing
 * here reads a session, a cookie or a role.
 */
export function StaffNav({ entries, unresolved = false }: StaffNavProps) {
  return (
    <nav aria-label="Panel menüsü" className="flex flex-col gap-2">
      {entries.length === 0 ? (
        <p className="px-3 py-2 text-xs text-ink-subtle" data-testid="staff-nav-empty">
          {unresolved
            ? "İzinler çözülemedi, bu yüzden menü boş. Aşağıdaki açıklamaya bakın."
            : "Erişebileceğiniz bir ekran yok."}
        </p>
      ) : (
        <ul className="flex flex-col gap-1">
          {entries.map((entry) => (
            <li key={entry.href}>
              <Link
                href={entry.href}
                className="block rounded-md px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
              >
                {entry.label}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}
