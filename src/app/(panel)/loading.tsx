/**
 * Panelin ortak yükleniyor görünümü (koala-admin#85).
 *
 * `(panel)/` seviyesinde tek tasarım: Next bunu sayfanın etrafına Suspense
 * olarak sarar, kabuk (menü, çıkış, tema) yerinde kalır ve yalnız sayfa alanı
 * bekler. Bölüm klasörlerindeki `loading.tsx` dosyaları bunu yeniden
 * dışa aktarır, ikinci bir iskelet değil: kuyruk ile nesne sayfası (`[id]`)
 * aynı segmentin iki çocuğu ve buradaki Suspense ikisi arasında geçilirken
 * zaten çizilmiş — React çizilmiş bir sınırı yeniden askıya almaz, eski
 * sayfayı yenisi gelene dek tutar. Sınır değişen çocuğun yanında olmalı.
 *
 * Ekran okuyucuya giden tek şey `role="status"` içindeki cümle. `aria-busy`
 * onun üstünde değil, iskeletin üstünde: yardımcı teknoloji meşgul bir canlı
 * bölgenin içeriğini erteleyebilir ve duyurulması istenen tek cümle
 * yutulurdu. İskelet `aria-hidden`; `motion-safe`, hareket azaltma tercihi
 * olan kişide nabız animasyonunu kapatır.
 */
export default function PanelLoading() {
  return (
    <div className="flex flex-col gap-6">
      <p role="status" className="sr-only">
        Sayfa yükleniyor…
      </p>
      <div
        aria-busy="true"
        aria-hidden="true"
        className="flex flex-col gap-6 motion-safe:animate-pulse"
      >
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
