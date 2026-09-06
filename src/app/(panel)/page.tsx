import Link from "next/link";

import { Badge } from "@/components/ui";
import { signOutFromKeycloak } from "@/server/auth/actions";
import { requireStaffSession } from "@/server/auth/session";

/**
 * Behind the session gate, like every page except the two sign-in surfaces and
 * the health probe.
 *
 * What it prints is worth being precise about. The name, the email and the role
 * names come from the session, which the `session` callback builds from a
 * whitelist — so no access token is rendered here, and none can be: this page
 * has no way to ask for one. `getKoalaAccessToken()` exists for that, it is
 * server-only, and its output goes into a `fetch` header rather than into HTML.
 *
 * The roles are shown as evidence, not as authorisation. What they permit is
 * #5's question, and it is answered by the backend.
 */
export default async function HomePage() {
  const session = await requireStaffSession();

  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Koala Yönetim Paneli</h1>
        <p className="text-sm text-ink-muted">
          İskelet ayakta. İzin çözümü ve iş kategorisi yönetimi ekranları bu katmanın üzerine
          gelecek.
        </p>
      </header>

      <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-6">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Oturum</h2>
          <p className="text-sm text-ink">{session.user?.name ?? session.user?.email}</p>
          <p className="text-xs text-ink-muted">{session.user?.email}</p>
        </div>

        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold text-ink-muted">
            Keycloak rolleri ({session.roles.length})
          </h3>
          <ul className="flex flex-wrap gap-2">
            {session.roles.map((role) => (
              <li key={role}>
                <Badge tone={role === "OWNER" ? "brand" : "neutral"}>{role}</Badge>
              </li>
            ))}
          </ul>
          <p className="text-xs text-ink-subtle">
            Rollerin hangi izinleri içerdiğini Keycloak değil Koala söyler; panel bunu bir sonraki
            dilimde backend&apos;e soracak.
          </p>
        </div>

        <form action={signOutFromKeycloak}>
          <button
            type="submit"
            className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
          >
            Çıkış yap
          </button>
        </form>
      </section>

      <section className="rounded-lg border border-border-subtle bg-surface p-6">
        <h2 className="text-sm font-semibold">Doğrulama</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Sunucu tarafı API katmanının canlı backend&apos;e karşı çalıştığını gösteren sayfa.
        </p>
        <Link
          href="/verification/job-categories"
          className="mt-4 inline-flex rounded-md bg-brand px-3 py-2 text-sm font-medium text-white hover:bg-brand-strong"
        >
          İş kategorileri
        </Link>
      </section>
    </main>
  );
}
