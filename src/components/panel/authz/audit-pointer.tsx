import Link from "next/link";
import type { ReactNode } from "react";

import type { Permission } from "@/server/authz/permissions";

/**
 * "Bu ekranda yaptığınız şey nereye yazıldı" — ve oraya giden bağlantı.
 *
 * Yetkilendirmeyi değiştiren her ekranın altında duruyor. İki ekranda birebir
 * aynı yapıyla iki kez yazılmıştı; ayrı duran tek şey metin ve denetim kaydına
 * götüren süzgecin izni, o yüzden ikisi prop.
 *
 * `permission` `Permission` olarak tipli, serbest metin değil: bağlantı bir
 * süzgece gidiyor ve yanlış yazılmış bir ad, boş bir denetim kaydı sayfası
 * açardı — hiçbir şey kırılmadan, hiçbir şey söylenmeden.
 */
export function AuditPointer({
  permission,
  linkLabel,
  children,
}: {
  /** Denetim kaydı süzgecine geçirilecek izin. */
  permission: Permission;
  linkLabel: string;
  /** Bu ekranın kayda ne yazdırdığı, kendi cümlesiyle. */
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">Her değişiklik denetim kaydında</h2>
      <p className="max-w-prose text-xs text-ink-muted">{children}</p>
      <p className="text-xs text-ink-muted">
        <Link
          href={{ pathname: "/audit-log", query: { permission } }}
          className="text-brand hover:underline"
        >
          {linkLabel}
        </Link>{" "}
        — <code className="font-mono">audit.read</code> izni gerekir.
      </p>
    </section>
  );
}
