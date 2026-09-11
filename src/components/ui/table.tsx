import type { HTMLAttributes, ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export interface TableProps {
  /** Screen-reader description of what the table lists. */
  caption?: string;
  children: ReactNode;
  className?: string;
}

export function Table({ caption, children, className }: TableProps) {
  return (
    <div className={cn("overflow-x-auto border border-border-subtle bg-surface", className)}>
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

export interface TableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  children: ReactNode;
}

/**
 * `className` and the rest of the `<tr>` attributes are passed through because
 * some rows mean something. The audit log's refused rows (`allowed = false`)
 * have to look different from the rest — they are the only visible trace of an
 * attempted privilege escalation — and a row that can only be styled from
 * inside this file would push that decision into the wrong module.
 */
export function TableRow({ children, className, ...rest }: TableRowProps) {
  return (
    <tr className={cn("hover:bg-surface-muted", className)} {...rest}>
      {children}
    </tr>
  );
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
        "px-3 py-2 text-xs font-medium text-ink-muted",
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
        "px-3 py-2 align-middle text-sm",
        numeric ? "text-right tabular-nums" : "text-left",
        className,
      )}
      {...rest}
    >
      {children}
    </td>
  );
}
