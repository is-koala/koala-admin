import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export interface TableProps {
  /** Screen-reader description of what the table lists. */
  caption?: string;
  children: ReactNode;
  className?: string;
}

export function Table({ caption, children, className }: TableProps) {
  return (
    <div
      className={cn("overflow-x-auto rounded-lg border border-border-subtle bg-surface", className)}
    >
      <table className="w-full border-collapse text-sm">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="bg-surface-sunken">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="divide-y divide-border-subtle">{children}</tbody>;
}

export function TableRow({ children }: { children: ReactNode }) {
  return <tr className="hover:bg-surface-muted">{children}</tr>;
}

export interface TableHeaderCellProps extends ThHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
  numeric?: boolean;
}

export function TableHeaderCell({
  children,
  numeric = false,
  className,
  ...rest
}: TableHeaderCellProps) {
  return (
    <th
      scope="col"
      className={cn(
        "px-4 py-2.5 text-xs font-semibold tracking-wide text-ink-muted uppercase",
        numeric ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  );
}

export interface TableCellProps extends TdHTMLAttributes<HTMLTableCellElement> {
  children: ReactNode;
  numeric?: boolean;
}

export function TableCell({ children, numeric = false, className, ...rest }: TableCellProps) {
  return (
    <td
      className={cn(
        "px-4 py-2.5 align-middle",
        numeric ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
