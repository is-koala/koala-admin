import Link from "next/link";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui";
import { formatCurrency, formatDate, formatDateTime, formatInteger } from "@/lib/format";
import { loadOpsHome } from "@/server/api/ops-snapshot";
import { getKoalaAccessToken, requireStaffSession } from "@/server/auth/session";
import { navigationFor } from "@/server/authz/routes";
import { getStaffContext } from "@/server/authz/staff-context";

/**
 * Operatör evi. Bekleyen kuyruklar, dönem finansı ve son denetim —
 * izin listesi değil. Doğrulama sayfası reklam edilmez.
 */
export default async function PanelHomePage() {
  await requireStaffSession();
  const context = await getStaffContext();
  const reachable = navigationFor(context.permissions);
  const home = await loadOpsHome(await getKoalaAccessToken(), context.permissions);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Güncel durum"
        description="Bugün sizin açabileceğiniz kuyruklar, dönem tahsilatı ve son işlemler."
      />

      {home.queues.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {home.queues.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm hover:bg-surface-muted"
            >
              <span className="text-xs font-medium text-ink-muted">{tile.label}</span>
              {tile.loadError !== null ? (
                <>
                  <span className="text-sm font-semibold tracking-tight text-ink">
                    {tile.loadError}
                  </span>
                  <span className="text-xs text-ink-subtle">
                    Sayfayı yenileyerek yeniden deneyin.
                  </span>
                </>
              ) : (
                <>
                  <span className="text-2xl font-semibold tracking-tight text-ink">
                    {tile.count === null ? "—" : formatInteger(tile.count)}
                  </span>
                  {tile.oldestAt !== null ? (
                    <span className="text-xs text-ink-subtle">
                      En eski {formatDate(tile.oldestAt)}
                    </span>
                  ) : (
                    <span className="text-xs text-ink-subtle">Kuyruğu aç</span>
                  )}
                </>
              )}
            </Link>
          ))}
        </section>
      ) : null}

      {home.finance !== null ? (
        <section className="grid gap-3 sm:grid-cols-3">
          <Link
            href="/finance"
            className="flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm hover:bg-surface-muted"
          >
            <span className="text-xs font-medium text-ink-muted">Tahsilat</span>
            <span className="text-2xl font-semibold tracking-tight text-ink">
              {formatCurrency(home.finance.employerVolume, home.finance.currency)}
            </span>
            <span className="text-xs text-ink-subtle">
              {formatInteger(home.finance.succeededPaymentCount)} başarılı işlem
            </span>
          </Link>
          <Link
            href="/finance"
            className="flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm hover:bg-surface-muted"
          >
            <span className="text-xs font-medium text-ink-muted">Hizmet bedeli</span>
            <span className="text-2xl font-semibold tracking-tight text-ink">
              {formatCurrency(home.finance.koalaFee, home.finance.currency)}
            </span>
            <span className="text-xs text-ink-subtle">Koala payı</span>
          </Link>
          <Link
            href="/finance"
            className="flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm hover:bg-surface-muted"
          >
            <span className="text-xs font-medium text-ink-muted">Bekleyen hakediş</span>
            <span className="text-2xl font-semibold tracking-tight text-ink">
              {formatCurrency(home.finance.awaitingPayoutAmount, home.finance.currency)}
            </span>
            <span className="text-xs text-ink-subtle">
              {formatInteger(home.finance.awaitingPayoutCount)} bekleyen kayıt
            </span>
          </Link>
        </section>
      ) : null}

      {home.recentAudit.length > 0 ? (
        <section className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold">Son işlemler</h2>
            <Link href="/audit-log" className="text-xs font-medium text-brand hover:underline">
              Denetim kaydı
            </Link>
          </div>
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
            {home.recentAudit.map((entry) => (
              <li key={entry.id} className="flex flex-col gap-0.5 px-4 py-2.5">
                <span className="text-sm text-ink">
                  {entry.actorDisplayName} · {entry.action}
                </span>
                <span className="text-xs text-ink-muted">{formatDateTime(entry.occurredAt)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm">
        <h2 className="text-sm font-semibold">Oturum</h2>
        <p className="mt-1 text-sm text-ink">{context.staff?.displayName ?? "—"}</p>
        <p className="text-xs text-ink-muted">{context.staff?.email ?? "—"}</p>
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {(context.staff?.roles ?? []).map((role) => (
            <li key={role}>
              <Badge tone={role === "OWNER" ? "brand" : "neutral"}>{role}</Badge>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-ink-subtle">Menü bu rollere göre çizilir.</p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold">Ekranlar</h2>
        {reachable.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">
            Şu an açık bir ekran yok. Menü de bu yüzden boş.
          </p>
        ) : (
          <ul className="divide-y divide-border-subtle overflow-hidden rounded-2xl border border-border-subtle bg-surface shadow-sm">
            {reachable.map((entry) => (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className="flex px-4 py-2.5 text-sm font-medium text-ink hover:bg-surface-muted"
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
