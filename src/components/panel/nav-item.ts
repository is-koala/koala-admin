import { cn } from "@/lib/cn";

/**
 * Açık yol bu menü girişinin altında mı? (koala-admin#85)
 *
 * Nesne sayfaları (`/reports/{id}`) menüde yok; ortak `error.tsx` ve
 * `not-found.tsx` de o yollarda çizilir. Tam eşleşme orada her girişi
 * söndürürdü. Segment sınırı (`href + "/"`) şart: düz `startsWith`,
 * `/users` girişini `/users-archive` gibi bir yolda da yakardı.
 */
export function isWithinSection(currentPath: string | undefined, href: string): boolean {
  if (currentPath === undefined) return false;
  return currentPath === href || currentPath.startsWith(`${href}/`);
}

export function navItemClass(active: boolean): string {
  return cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
    active ? "bg-brand-soft text-brand-strong" : "text-ink hover:bg-surface-muted",
  );
}
