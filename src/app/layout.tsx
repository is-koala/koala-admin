import type { Metadata } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import type { ReactNode } from "react";

import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
  variable: "--font-plex",
});

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
    <html lang="tr" className={plexSans.variable}>
      <body className={`${plexSans.className} min-h-dvh antialiased`}>{children}</body>
    </html>
  );
}
