import Link from "next/link";

import { PageHeader } from "@/components/panel/page-header";
import { Badge } from "@/components/ui";
import { formatInteger } from "@/lib/format";
import { loadOpsSnapshot } from "@/server/api/ops-snapshot";
import { getKoalaAccessToken, requireStaffSession } from "@/server/auth/session";
import { permissionLabel } from "@/server/authz/permissions";
import { navigationFor } from "@/server/authz/routes";
import { getStaffContext } from "@/server/authz/staff-context";

/**
 * Operatör evi. Rol/izin kartları durur çünkü menü onlara bağlıdır; asıl iş
 * bekleyen kuyruk sayılarıdır. Doğrulama sayfası reklam edilmez.
 */
export default async function PanelHomePage() {
  await requireStaffSession();
  const context = await getStaffContext();
  const reachable = navigationFor(context.permissions);
  const queues = await loadOpsSnapshot(await getKoalaAccessToken(), context.permissions);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Güncel durum"
        description="Bugün sizin açabileceğiniz kuyruklar. Sayılar her açılışta backend'den gelir."
      />

      {queues.length > 0 ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {queues.map((tile) => (
            <Link
              key={tile.href}
              href={tile.href}
              className="flex flex-col gap-1 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm hover:bg-surface-muted"
            >
              <span className="text-xs font-medium text-ink-muted">{tile.label}</span>
              <span className="text-2xl font-semibold tracking-tight text-ink">
                {tile.count === null ? "—" : formatInteger(tile.count)}
              </span>
              <span className="text-xs text-ink-subtle">Kuyruğu aç</span>
            </Link>
          ))}
        </section>
      ) : null}

      <section className="grid gap-4 md:grid-cols-2">
        <article className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Oturum</h2>
            <p className="text-sm text-ink">{context.staff?.displayName ?? "—"}</p>
            <p className="text-xs text-ink-muted">{context.staff?.email ?? "—"}</p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-ink-muted">
              Roller ({context.staff?.roles.length ?? 0})
            </h3>
            <ul className="flex flex-wrap gap-1.5">
              {(context.staff?.roles ?? []).map((role) => (
                <li key={role}>
                  <Badge tone={role === "OWNER" ? "brand" : "neutral"}>{role}</Badge>
                </li>
              ))}
            </ul>
          </div>
        </article>

        <article className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface p-5 shadow-sm">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">İzinler</h2>
            <p className="text-xs text-ink-muted">
              {context.staff === null
                ? "Personel kaydı okunamadı; menü boş kabul edildi."
                : "Her istekte yeniden çözülür. Token'da taşınmaz."}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-medium text-ink-muted">
              Etkin izinler ({context.permissions.length})
            </h3>
            {context.permissions.length === 0 ? (
              <p className="text-sm text-ink">Hiçbir izniniz yok.</p>
            ) : (
              <ul className="flex flex-col gap-0.5">
                {context.permissions.map((permission) => (
                  <li key={permission} className="text-sm text-ink">
                    <span className="font-mono text-xs text-ink-muted">{permission}</span>{" "}
                    {permissionLabel(permission)}
                  </li>
                ))}
              </ul>
            )}
            {context.staff !== null && context.staff.unknownPermissions.length > 0 ? (
              <p className="text-xs text-warning">
                Bu panel sürümünün tanımadığı izinler: {context.staff.unknownPermissions.join(", ")}
              </p>
            ) : null}
          </div>
        </article>
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
