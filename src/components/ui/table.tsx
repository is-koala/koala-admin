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
    <div className={cn("table-root table-root--primary", className)}>
      <div className="table__scroll-container">
        <table className="table__content">
          {caption ? <caption className="sr-only">{caption}</caption> : null}
          {children}
        </table>
      </div>
    </div>
  );
}

export function TableHead({ children }: { children: ReactNode }) {
  return <thead className="table__header">{children}</thead>;
}

export function TableBody({ children }: { children: ReactNode }) {
  return <tbody className="table__body">{children}</tbody>;
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
    <tr className={cn("table__row", className)} {...rest}>
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
      className={cn("table__column", numeric ? "text-right tabular-nums" : "text-left", className)}
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
      className={cn("table__cell", numeric ? "text-right tabular-nums" : "text-left", className)}
      {...rest}
    >
      {children}
    </td>
  );
}
