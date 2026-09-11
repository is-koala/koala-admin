import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { ThemeToggle } from "@/components/panel/theme-toggle";
import { THEME_COOKIE, parseTheme } from "@/lib/theme";

export interface AuthShellProps {
  children: ReactNode;
}

/**
 * Sign-in chrome matches the panel: branded top bar, quiet canvas, a card
 * for the form. The form itself stays a plain POST — this wrapper is chrome.
 */
export async function AuthShell({ children }: AuthShellProps) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between bg-topbar px-4 text-on-brand">
        <p className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">koala</span>
          <span className="text-xs font-medium text-on-brand/80">Yönetim</span>
        </p>
        <ThemeToggle initialTheme={theme} />
      </header>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-6 py-16">
        <div className="mx-auto w-full max-w-md rounded-2xl border border-border-subtle bg-surface p-8 shadow-sm">
          {children}
        </div>
      </div>
    </div>
  );
}
