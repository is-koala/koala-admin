import type { ReactNode } from "react";

export interface AuthShellProps {
  children: ReactNode;
}

/**
 * The unauthenticated surfaces share the panel's bark rail so a sign-in
 * page is recognisably the same product, not a centred marketing card.
 *
 * The form itself stays a plain POST — this wrapper is chrome.
 */
export function AuthShell({ children }: AuthShellProps) {
  return (
    <div className="flex min-h-dvh bg-mist">
      <aside className="hidden w-56 shrink-0 flex-col bg-bark px-5 py-8 text-bark-ink md:flex">
        <p className="text-sm font-semibold">Koala</p>
        <p className="mt-1 text-xs text-bark-muted">Yönetim paneli</p>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col justify-center px-6 py-16">
        <div className="w-full max-w-lg">{children}</div>
      </div>
    </div>
  );
}
