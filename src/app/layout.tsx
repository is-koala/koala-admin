import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Koala Yönetim Paneli",
    template: "%s · Koala Yönetim Paneli",
  },
  description: "Koala pazaryerinin operasyon paneli.",
  robots: { index: false, follow: false },
};

/**
 * Typed explicitly rather than with Next's generated `LayoutProps<"/">`: that
 * global only exists once `.next/types` has been produced by a build, and
 * `pnpm typecheck` has to pass on a clean checkout, before `pnpm build` runs.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <body className="min-h-dvh antialiased">{children}</body>
    </html>
  );
}
