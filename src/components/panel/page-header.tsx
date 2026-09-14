import Link from "next/link";
import type { ReactNode } from "react";

import type { BreadcrumbItem } from "@/lib/breadcrumb";
import { cn } from "@/lib/cn";

export interface PageHeaderProps {
  /** The screen's name, already in Turkish. */
  title: string;
  /** One or two sentences of what this screen is for, and which permission. */
  description?: ReactNode;
  /**
   * Konum: liste › nesne (koala-admin#112). Son öğe geçerli sayfadır ve
   * bağlantı değildir; öncekiler geldiği süzgeci taşıyan liste adresleridir.
   */
  breadcrumb?: readonly BreadcrumbItem[];
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
export function PageHeader({
  title,
  description,
  breadcrumb,
  children,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn("flex flex-wrap items-start justify-between gap-3", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        {breadcrumb !== undefined && breadcrumb.length > 0 ? (
          <Breadcrumb items={breadcrumb} />
        ) : null}
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? (
          <div className="max-w-prose text-sm text-ink-muted">{description}</div>
        ) : null}
      </div>
      {children ? <div className="flex flex-wrap items-center gap-2">{children}</div> : null}
    </header>
  );
}

/**
 * `nav aria-label="Konum"` + sıralı liste: ekran okuyucu "Konum, liste, 2
 * öğe" der; ayraç süslemedir ve okunmaz. Son öğe `aria-current="page"`.
 */
function Breadcrumb({ items }: { items: readonly BreadcrumbItem[] }) {
  const last = items.length - 1;
  return (
    <nav aria-label="Konum">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-sm text-ink-muted">
        {items.map((item, index) => {
          const current = index === last;
          const text = (
            <span className={cn(item.mono ? "font-mono text-xs" : null)} title={item.title}>
              {item.label}
            </span>
          );
          return (
            <li key={`${index}-${item.label}`} className="flex items-center gap-x-1.5">
              {item.href !== undefined && !current ? (
                <Link href={item.href} className="text-brand hover:underline">
                  {text}
                </Link>
              ) : (
                <span aria-current={current ? "page" : undefined} className="text-ink">
                  {text}
                </span>
              )}
              {current ? null : (
                <span aria-hidden="true" className="text-ink-subtle">
                  ›
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
