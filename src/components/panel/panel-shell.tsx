"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { cn } from "@/lib/cn";

import { CommandPalette } from "./command-palette";
import { HomeNavIcon } from "./nav-icons";
import { navItemClass } from "./nav-item";
import { StaffNav } from "./staff-nav";
import { ThemeToggle } from "./theme-toggle";
import type { DrawnNavEntry } from "./nav-types";

export interface PanelShellStaff {
  readonly displayName: string;
  readonly email: string;
}

export interface PanelShellProps {
  staff: PanelShellStaff | null;
  entries: readonly DrawnNavEntry[];
  unresolved?: boolean;
  initialTheme?: "light" | "dark";
  signOut: () => void | Promise<void>;
  children: ReactNode;
}

/**
 * Merchant-panel kromu: ince marka üst çubuk, ikonlu yan menü, ferah tuval.
 *
 * Daraltma yalnız istemcide — ilk SSR boyasına gerek yok.
 * Tema document'te durur ki giriş ve panel aynı paleti paylaşsın.
 */
export function PanelShell({
  staff,
  entries,
  unresolved = false,
  initialTheme = "light",
  signOut,
  children,
}: PanelShellProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  return (
    <div className="flex min-h-dvh flex-col bg-canvas">
      <header className="flex h-12 shrink-0 items-center justify-between bg-topbar px-4 text-on-brand">
        <Link href="/" className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">koala</span>
          <span className="text-xs font-medium text-on-brand/80">Yönetim</span>
        </Link>
        <div className="flex items-center gap-2">
          <CommandPalette />
          <ThemeToggle initialTheme={initialTheme} />
          {staff === null ? null : (
            <div className="hidden items-center gap-2 sm:flex">
              <span className="max-w-48 truncate text-sm" title={staff.email}>
                {staff.displayName}
              </span>
            </div>
          )}
          <form action={signOut}>
            <button
              type="submit"
              className="rounded-full px-3 py-1.5 text-sm font-medium hover:bg-white/15"
            >
              Çıkış yap
            </button>
          </form>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside
          className={cn(
            "flex shrink-0 flex-col border-r border-border-subtle bg-surface",
            "md:sticky md:top-12 md:h-[calc(100dvh-3rem)]",
            collapsed ? "w-full md:w-[4.5rem]" : "w-full md:w-60",
          )}
        >
          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-3">
            <Link href="/" className={navItemClass(pathname === "/")} title="Güncel durum">
              <HomeNavIcon />
              {collapsed ? <span className="sr-only">Güncel durum</span> : "Güncel durum"}
            </Link>
            <div className="mt-3">
              <StaffNav
                entries={entries}
                unresolved={unresolved}
                currentPath={pathname}
                collapsed={collapsed}
              />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setCollapsed((value) => !value)}
            className="flex items-center gap-2 border-t border-border-subtle px-3 py-3 text-sm text-ink-muted hover:bg-surface-muted"
          >
            <CollapseIcon collapsed={collapsed} />
            {collapsed ? <span className="sr-only">Menüyü göster</span> : "Menüyü gizle"}
          </button>
        </aside>

        <main className="flex min-w-0 flex-1 flex-col gap-6 bg-canvas px-4 py-6 md:px-8 md:py-8">
          {children}
        </main>
      </div>
    </div>
  );
}

function CollapseIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" aria-hidden="true">
      <path
        d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"}
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
