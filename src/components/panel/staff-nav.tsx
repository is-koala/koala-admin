import Link from "next/link";

import type { NavEntry, NavGroupId } from "@/server/authz/routes";

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
 * The labels the operator reads. Ids stay in the registry; Turkish copy lives
 * next to the drawing so a new group cannot appear as an English identifier.
 *
 * Sentence case on purpose: tracked-out all-caps group labels are the generic
 * admin-template tell, and they do not encode anything the heading is not
 * already saying.
 */
const NAV_GROUP_LABELS: Record<NavGroupId, string> = {
  katalog: "Katalog",
  operasyon: "Operasyon",
  finans: "Finans",
  yonetim: "Yönetim",
};

interface NavGroup {
  readonly id: NavGroupId;
  readonly label: string;
  readonly entries: readonly NavEntry[];
}

/**
 * Collapse a sorted menu into sections. Consecutive entries that share a
 * group become one heading; a later return to the same group would paint it
 * twice, which `routes.test.ts` forbids by requiring contiguity.
 */
function groupNavEntries(entries: readonly NavEntry[]): readonly NavGroup[] {
  const groups: NavGroup[] = [];

  for (const entry of entries) {
    const current = groups.at(-1);
    if (current !== undefined && current.id === entry.group) {
      groups[groups.length - 1] = {
        ...current,
        entries: [...current.entries, entry],
      };
      continue;
    }

    groups.push({
      id: entry.group,
      label: NAV_GROUP_LABELS[entry.group],
      entries: [entry],
    });
  }

  return groups;
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
  const groups = groupNavEntries(entries);

  return (
    <nav aria-label="Panel menüsü" className="flex flex-col gap-4">
      {entries.length === 0 ? (
        <p className="px-2 py-1.5 text-xs text-bark-muted" data-testid="staff-nav-empty">
          {unresolved
            ? "İzinler çözülemedi, bu yüzden menü boş. Aşağıdaki açıklamaya bakın."
            : "Erişebileceğiniz bir ekran yok."}
        </p>
      ) : (
        groups.map((group) => (
          <div key={group.id} className="flex flex-col gap-1">
            <p id={`nav-${group.id}`} className="px-2 text-xs font-medium text-bark-muted">
              {group.label}
            </p>
            <ul className="flex flex-col" aria-labelledby={`nav-${group.id}`}>
              {group.entries.map((entry) => (
                <li key={entry.href}>
                  <Link
                    href={entry.href}
                    className="block rounded-sm px-2 py-1.5 text-sm text-bark-ink hover:bg-bark-hover"
                  >
                    {entry.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))
      )}
    </nav>
  );
}
