import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

const CONTROL_CLASSES =
  "w-full rounded-sm border border-border-strong bg-surface px-2.5 py-1.5 text-sm text-ink " +
  "placeholder:text-ink-subtle disabled:cursor-not-allowed disabled:bg-surface-sunken " +
  "aria-[invalid=true]:border-danger";

export interface FormFieldProps {
  /**
   * Required rather than generated: these components render in Server
   * Components too, where `useId` is not available. An explicit id also makes
   * the label/control/error wiring visible at the call site.
   */
  id: string;
  label: string;
  /** Renders the field's control. Wire `id`, `aria-describedby` from the args. */
  children: (args: { id: string; describedBy: string | undefined; invalid: boolean }) => ReactNode;
  hint?: string;
  /** A single message, typically one `FieldError.message` from the backend. */
  error?: string | null;
  required?: boolean;
  className?: string;
}

export function FormField({
  id,
  label,
  children,
  hint,
  error,
  required = false,
  className,
}: FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {required ? (
          <span className="text-danger" aria-hidden="true">
            {" *"}
          </span>
        ) : null}
      </label>

      {children({ id, describedBy, invalid: Boolean(error) })}

      {hint ? (
        <p id={hintId} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export type TextInputProps = InputHTMLAttributes<HTMLInputElement>;

export function TextInput({ className, ...rest }: TextInputProps) {
  return <input className={cn(CONTROL_CLASSES, className)} {...rest} />;
}

export type SelectInputProps = SelectHTMLAttributes<HTMLSelectElement>;

export function SelectInput({ className, children, ...rest }: SelectInputProps) {
  return (
    <select className={cn(CONTROL_CLASSES, className)} {...rest}>
      {children}
    </select>
  );
}
