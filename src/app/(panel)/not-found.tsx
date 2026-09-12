import Link from "next/link";

import { PageHeader } from "@/components/panel/page-header";

/**
 * Panelin 404 yüzeyi (koala-admin#85).
 *
 * Bir nesne sayfası `notFound()` dediğinde Next en yakın `not-found.tsx`'i
 * çizer; `(panel)/` seviyesindeki bu dosya kabuğun içinde kalır, yani menü
 * açık sayfanın bölümünü göstermeye devam eder ve kişi bir tıkla kuyruğa döner.
 *
 * Bilerek `role="alert"` değil ve `ErrorState` kullanılmıyor: bozuk bir şey
 * yok, adres hiçbir kaydı adreslemiyor. Bunu "yüklenemedi" gibi göstermek
 * operatörü olmayan bir kesintiyi aramaya gönderirdi. Aynı sebeple backend'in
 * mesajı da yok — silinmiş bir kaydın adı ya da kimliği burada işe yaramaz.
 */
export default function PanelNotFound() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kayıt bulunamadı"
        description="404 — Bu adreste gösterilecek bir kayıt yok."
      />

      <section className="flex flex-col gap-3 rounded-2xl border border-border-subtle bg-surface px-5 py-6 shadow-sm">
        <p className="max-w-prose text-sm text-ink">
          Bağlantı eski olabilir, kayıt silinmiş olabilir ya da kimlik yanlış yazılmış olabilir.
          Panel bu adres için veri uydurmaz; kaydı menüdeki kuyruktan yeniden seçin.
        </p>
        <p className="text-sm">
          <Link href="/" className="font-medium text-brand hover:underline">
            Güncel duruma dön
          </Link>
        </p>
      </section>
    </div>
  );
}
