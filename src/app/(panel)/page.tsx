import Link from "next/link";

import { Badge } from "@/components/ui";
import { requireStaffSession } from "@/server/auth/session";
import { permissionLabel } from "@/server/authz/permissions";
import { navigationFor } from "@/server/authz/routes";
import { getStaffContext } from "@/server/authz/staff-context";

/**
 * The landing page, and the one screen that is deliberately not
 * permission-gated (`src/server/authz/routes.ts` records why).
 *
 * It shows the two answers side by side because they come from two systems and
 * confusing them is the mistake ADR-0010 exists to prevent. Keycloak's realm
 * roles arrive in the session and say who you are. Koala's permissions arrive
 * from `GET /admin/me` on this request and say what you may do. The panel never
 * derives the second from the first, and printing both makes that visible
 * rather than merely documented.
 *
 * When the permission side cannot be resolved, the shell above renders the
 * explanation and this page shows an empty list — which is the honest picture:
 * signed in, and permitted nothing.
 */
export default async function PanelHomePage() {
  const session = await requireStaffSession();
  const context = await getStaffContext();
  const reachable = navigationFor(context.permissions);

  return (
    <div className="flex flex-col gap-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Panel</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Kim olduğunuzu Keycloak, ne yapabildiğinizi Koala söyler. Panel ikincisini her istekte
          backend&apos;e sorar ve hiçbir yerde saklamaz.
        </p>
      </header>

      <section className="grid gap-4 md:grid-cols-2">
        <article className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Kimlik · Keycloak</h2>
            <p className="text-sm text-ink">{session.user?.name ?? session.user?.email}</p>
            <p className="text-xs text-ink-muted">{session.user?.email}</p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-ink-muted">
              Token&apos;daki realm rolleri ({session.roles.length})
            </h3>
            <ul className="flex flex-wrap gap-2">
              {session.roles.map((role) => (
                <li key={role}>
                  <Badge tone={role === "OWNER" ? "brand" : "neutral"}>{role}</Badge>
                </li>
              ))}
            </ul>
            <p className="text-xs text-ink-subtle">
              Bu liste yalnız rol üyeliğidir. Hangi işlemi açtığı buradan okunmaz.
            </p>
          </div>
        </article>

        <article className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-5">
          <div className="flex flex-col gap-1">
            <h2 className="text-sm font-semibold">Yetki · Koala</h2>
            <p className="text-sm text-ink">
              {context.staff?.displayName ?? "Personel kaydı çözülemedi"}
            </p>
            <p className="text-xs text-ink-muted">
              {context.staff === null
                ? "GET /admin/me yanıt vermedi; izin listesi boş kabul edildi."
                : `Backend'in çözdüğü roller: ${context.staff.roles.join(", ") || "—"}`}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-xs font-semibold text-ink-muted">
              Etkin izinler ({context.permissions.length})
            </h3>
            {context.permissions.length === 0 ? (
              <p className="text-sm text-ink">Hiçbir izniniz yok.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {context.permissions.map((permission) => (
                  <li key={permission} className="text-sm text-ink">
                    <span className="font-mono text-xs text-ink-muted">{permission}</span> ·{" "}
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

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Erişebildiğiniz ekranlar</h2>
        {reachable.length === 0 ? (
          <p className="max-w-prose text-sm text-ink-muted">
            Şu an açık bir ekran yok. Menü de bu yüzden boş: panel, izniniz olduğunu varsaymaz.
          </p>
        ) : (
          <ul className="flex flex-wrap gap-3">
            {reachable.map((entry) => (
              <li key={entry.href}>
                <Link
                  href={entry.href}
                  className="inline-flex rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
                >
                  {entry.label}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-5">
        <h2 className="text-sm font-semibold">Doğrulama</h2>
        <p className="mt-1 max-w-prose text-sm text-ink-muted">
          Sunucu tarafı API katmanının canlı backend&apos;e karşı çalıştığını gösteren sayfa; izin
          çözümünden bağımsız çalışır.
        </p>
        <Link
          href="/verification/job-categories"
          className="mt-4 inline-flex rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
        >
          İş kategorileri (doğrulama)
        </Link>
      </section>
    </div>
  );
}
