import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  /** The screen's name, already in Turkish. */
  title: string;
  /** One or two sentences of what this screen is for, and which permission. */
  description?: ReactNode;
  /** Optional actions that belong next to the title, not buried in the table. */
  children?: ReactNode;
  className?: string;
}

/**
 * The title row of a panel screen.
 *
 * Merchant panels lead with a calm title and a short status line, not a
 * marketing hero. Copy stays the page's job; this component only places it.
 */
export function PageHeader({ title, description, children, className }: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <div className="max-w-prose text-sm text-ink-muted">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}
