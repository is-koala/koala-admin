"use client";

import Link from "next/link";

import { PageHeader } from "@/components/panel/page-header";
import { Button, ErrorState } from "@/components/ui";

/**
 * Panelin beklenmeyen hata sınırı (koala-admin#85).
 *
 * `(panel)/` seviyesinde tek dosya: sayfa ve altındaki her şey bu sınırın
 * içinde, `layout.tsx` dışında. Yani menü, çıkış düğmesi ve tema anahtarı
 * hata anında da ayakta kalır; kişi nerede olduğunu görür ve çıkabilir.
 *
 * `error.message` bilerek çizilmiyor. Bu bir Client Component ve fırlatılan
 * nesne geliştirmede orijinal mesajıyla gelir; bir `KoalaApiError` mesajı
 * upstream yolu, metodu ve durum kodunu taşır. Ekrana yalnız nötr Türkçe
 * cümle ve `digest` çıkar: digest, sunucu günlüğündeki satırın anahtarıdır
 * (backend `requestId`'sinin panel tarafındaki karşılığı) ve içerik taşımaz.
 *
 * Düğme Next'in `retry`'ını çağırır, `reset`'i değil: `retry` bölümü yeniden
 * getirir ve çizer; `reset` yalnız sınır durumunu temizler ve aynı bayat
 * ağacı yeniden gösterirdi. Geçici bir backend hatasında işe yarayan
 * ilkidir (`node_modules/next/dist/docs/.../error.md`).
 */
export default function PanelError({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  reset: () => void;
}) {
  const digest = typeof error.digest === "string" && error.digest.length > 0 ? error.digest : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Beklenmeyen bir hata oluştu"
        description="Sayfa hazırlanırken panel bir hatayla karşılaştı. Menü ve oturumunuz duruyor; sorun bu sayfayla sınırlı."
      />

      <ErrorState
        title="Sayfa gösterilemedi."
        description="Bu geçici olabilir. Tekrar deneyin; sürerse güncel duruma dönün ve hata imzasıyla bildirin."
        action={
          <div className="flex flex-col gap-3">
            {digest === null ? null : (
              <p className="text-xs text-ink-muted">
                Hata imzası: <span className="font-mono break-all">{digest}</span>
              </p>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="button" variant="primary" onClick={() => retry()}>
                Tekrar dene
              </Button>
              <Link href="/" className="text-sm font-medium text-brand hover:underline">
                Güncel duruma dön
              </Link>
            </div>
          </div>
        }
      />
    </div>
  );
}
