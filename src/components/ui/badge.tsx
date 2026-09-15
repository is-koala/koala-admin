import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type BadgeTone = "neutral" | "brand" | "success" | "warning" | "danger";

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: "chip--default chip--soft",
  brand: "chip--accent chip--soft",
  success: "chip--success chip--soft",
  warning: "chip--warning chip--soft",
  danger: "chip--danger chip--soft",
};

export interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span className={cn("chip", TONE_CLASSES[tone], className)}>
      <span className="chip__label">{children}</span>
    </span>
  );
}
