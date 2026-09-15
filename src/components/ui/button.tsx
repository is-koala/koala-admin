import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "danger-soft";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
}

const VARIANT: Record<ButtonVariant, string> = {
  primary: "button--primary",
  secondary: "button--secondary",
  ghost: "button--ghost",
  danger: "button--danger",
  "danger-soft": "button--danger-soft",
};

const SIZE: Record<ButtonSize, string> = {
  sm: "button--sm",
  md: "button--md",
  lg: "button--lg",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant;
  size?: ButtonSize;
  fullWidth?: boolean;
  className?: string;
} = {}): string {
  return cn("button", VARIANT[variant], SIZE[size], fullWidth && "button--full-width", className);
}

export function Button({
  variant = "primary",
  size = "md",
  fullWidth = false,
  className,
  type = "button",
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClass({ variant, size, fullWidth, className })}
    />
  );
}
