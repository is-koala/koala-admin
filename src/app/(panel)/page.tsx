import Link from "next/link";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui";
import { cn } from "@/lib/cn";
import { formatCurrency, formatDate, formatDateTime, formatInteger } from "@/lib/format";
import { SLA_HOURS, overdueCountText } from "@/lib/queue-sla";
import { loadOpsHome, type OpsAlertTile, type OpsQueueTile } from "@/server/api/ops-snapshot";
import { getKoalaAccessToken, requireStaffSession } from "@/server/auth/session";
import { getStaffContext } from "@/server/authz/staff-context";

const TILE_CLASS =
  "flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm";

/**
 * Operatör evi. Bekleyen kuyruklar, SLA eşiğini aşanlar, takılı ödeme ve
 * vadesi geçmiş hakediş alarmları, dönem finansı ve son denetim — izin
 * listesi değil. "Ekranlar" bölümü menüyle aynı listeyi yazdığı için
 * kaldırıldı (koala-admin#111). Doğrulama sayfası reklam edilmez.
 */
export default async function PanelHomePage() {
  await requireStaffSession();
  const context = await getStaffContext();
  const home = await loadOpsHome(await getKoalaAccessToken(), context.permissions);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Güncel durum"
        description="Bugün sizin açabileceğiniz kuyruklar, dönem tahsilatı ve son işlemler."
      />

      {home.queues.length > 0 || home.alerts.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {home.queues.map((tile) => (
            <QueueTile key={tile.href} tile={tile} />
          ))}
          {home.alerts.map((tile) => (
            <AlertTile key={tile.key} tile={tile} />
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
    </div>
  );
}

/**
 * Bir kuyruk karosu. Karo bağlantı değil kart: başlık kuyruğu, eşik satırı
 * yaşa göre sıralı listeyi açar — iç içe iki `<a>` geçersiz HTML olurdu.
 * Eşiği aşan sayı sıfırken de yazılır (sessiz yeşil), sıfırdan büyükken
 * kırmızı; "50+" örneklemin tükendiğini söyler, sayı uydurmaz.
 */
function QueueTile({ tile }: { tile: OpsQueueTile }) {
  return (
    <article className={TILE_CLASS} data-testid={`queue-tile-${tile.href.slice(1)}`}>
      <Link href={tile.href} className="text-xs font-medium text-ink-muted hover:underline">
        {tile.label}
      </Link>
      {tile.loadError !== null ? (
        <TileError message={tile.loadError} />
      ) : (
        <>
          <Link href={tile.href} className="text-2xl font-semibold tracking-tight text-ink">
            {tile.count === null ? "—" : formatInteger(tile.count)}
          </Link>
          {tile.description !== null ? (
            <span className="text-xs text-ink-subtle">{tile.description}</span>
          ) : null}
          {tile.oldestAt !== null ? (
            <span className="text-xs text-ink-subtle">En eski {formatDate(tile.oldestAt)}</span>
          ) : (
            <span className="text-xs text-ink-subtle">Kuyruğu aç</span>
          )}
          {tile.overdue !== null ? (
            <Link
              href={tile.overdue.href}
              data-testid="queue-tile-overdue"
              className={cn(
                "text-xs font-medium hover:underline",
                tile.overdue.count > 0 ? "text-danger" : "text-success",
              )}
            >
              {overdueCountText(tile.overdue, formatInteger)} kayıt {SLA_HOURS} saati aştı
            </Link>
          ) : null}
        </>
      )}
    </article>
  );
}

/** Karo yüklenemedi: sayı yerine hata ve yenileme ipucu; kuyruk ve alarm karoları aynı parçayı çizer. */
function TileError({ message }: { message: string }) {
  return (
    <>
      <span className="text-sm font-semibold tracking-tight text-ink">{message}</span>
      <span className="text-xs text-ink-subtle">Sayfayı yenileyerek yeniden deneyin.</span>
    </>
  );
}

/**
 * Ödeme/hakediş alarmı: sıfır sessiz, sıfırdan büyük kırmızı; bağlantı yalnız
 * liste izniyle. `capped` sayı örneklemden geldiğinde "12+" yazar.
 */
function AlertTile({ tile }: { tile: OpsAlertTile }) {
  const body =
    tile.loadError !== null ? (
      <TileError message={tile.loadError} />
    ) : (
      <>
        <span
          className={cn(
            "text-2xl font-semibold tracking-tight",
            tile.count !== null && tile.count > 0 ? "text-danger" : "text-ink",
          )}
        >
          {tile.count === null
            ? "—"
            : overdueCountText({ count: tile.count, capped: tile.capped }, formatInteger)}
        </span>
        <span className="text-xs text-ink-subtle">{tile.description}</span>
      </>
    );
  const label = <span className="text-xs font-medium text-ink-muted">{tile.label}</span>;
  if (tile.href === null) {
    return (
      <article className={TILE_CLASS} data-testid={`alert-tile-${tile.key}`}>
        {label}
        {body}
      </article>
    );
  }
  return (
    <Link
      href={tile.href}
      className={cn(TILE_CLASS, "hover:bg-surface-muted")}
      data-testid={`alert-tile-${tile.key}`}
    >
      {label}
      {body}
    </Link>
  );
}
