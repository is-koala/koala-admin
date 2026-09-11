import { cn } from "@/lib/cn";

export function navItemClass(active: boolean): string {
  return cn(
    "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium",
    active ? "bg-brand-soft text-brand-strong" : "text-ink hover:bg-surface-muted",
  );
}
