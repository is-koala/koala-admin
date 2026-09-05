import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Koala Yönetim Paneli</h1>
        <p className="text-sm text-ink-muted">
          İskelet ayakta. Kimlik doğrulama, izin çözümü ve iş kategorisi yönetimi ekranları bu
          katmanın üzerine gelecek.
        </p>
      </header>

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
