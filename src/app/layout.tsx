import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { THEME_BOOTSTRAP_SCRIPT, THEME_COOKIE, parseTheme } from "@/lib/theme";

import "./globals.css";

const inter = Inter({
  subsets: ["latin", "latin-ext"],
  display: "swap",
  variable: "--font-ui",
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
export default async function RootLayout({ children }: { children: ReactNode }) {
  const theme = parseTheme((await cookies()).get(THEME_COOKIE)?.value);

  return (
    <html lang="tr" className={inter.variable} data-theme={theme} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={`${inter.className} min-h-dvh antialiased`}>{children}</body>
    </html>
  );
}
