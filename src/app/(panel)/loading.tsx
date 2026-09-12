/**
 * Panelin ortak yükleniyor görünümü (koala-admin#85).
 *
 * `(panel)/` seviyesinde tek dosya: Next bunu her sayfanın etrafına Suspense
 * olarak sarar, kabuk (menü, çıkış, tema) yerinde kalır ve yalnız sayfa alanı
 * bekler. Bölüm başına kopya, aynı iskeleti N yerde tutmak olurdu.
 *
 * Görsel iskelet `aria-hidden`; ekran okuyucuya giden tek şey `role="status"`
 * ve içindeki cümle. `aria-busy` bölgenin henüz bitmediğini söyler, ki
 * yardımcı teknoloji yarım bir sayfayı "sayfa bu kadar" diye okumasın.
 * `motion-safe`: hareket azaltma tercihi olan kişide nabız animasyonu yok.
 */
export default function PanelLoading() {
  return (
    <div role="status" aria-busy="true" aria-live="polite" className="flex flex-col gap-6">
      <span className="sr-only">Sayfa yükleniyor…</span>
      <div aria-hidden="true" className="flex flex-col gap-6 motion-safe:animate-pulse">
        <div className="flex flex-col gap-2">
          <div className="h-7 w-56 max-w-full rounded-md bg-surface-sunken" />
          <div className="h-4 w-96 max-w-full rounded-md bg-surface-sunken" />
        </div>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div className="h-24 rounded-2xl border border-border-subtle bg-surface" />
          <div className="h-24 rounded-2xl border border-border-subtle bg-surface" />
          <div className="h-24 rounded-2xl border border-border-subtle bg-surface" />
          <div className="h-24 rounded-2xl border border-border-subtle bg-surface" />
        </div>
        <div className="h-64 rounded-2xl border border-border-subtle bg-surface" />
      </div>
    </div>
  );
}
