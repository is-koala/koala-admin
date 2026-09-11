import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** A primary action, e.g. "Kategori ekle". */
  action?: ReactNode;
  className?: string;
}

/**
 * "There is nothing here yet" — distinct from "we could not load it"
 * ({@link import("./error-state").ErrorState}). Confusing the two is how an
 * operator ends up believing a category list is genuinely empty when the API
 * was down.
 */
export function EmptyState({ title, description, action, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-start gap-2 border border-dashed border-border-strong",
        "bg-surface px-4 py-8 text-left",
        className,
      )}
    >
      <p className="text-sm font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-prose text-sm text-ink-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
