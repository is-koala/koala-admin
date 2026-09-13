import { env } from "@/env";
import { ALLOWLIST_ENV_KEY } from "@/lib/evidence-download";

/**
 * Personele, fotoğraf kutuları "indirilemedi" demeden önce nedenini söyler:
 * liste boşken backend'in 302 ile verdiği her imzalı adres reddedilir.
 *
 * Sunucu bileşeni; `env`'i okur, o yüzden tarayıcıya inmez. Yalnız izin
 * kapısının içinde çizilir — müşteri yüzeyi yok, müşteri metni değişmez.
 * Kutuların yerine geçmez: yerel depolama 200 ile doğrudan akıtır ve boş
 * liste orada meşru; kutular denemeye devam eder.
 */
export function SignedDownloadAllowlistNotice({ subject }: { subject: string }) {
  if (env.EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS.length > 0) return null;

  return (
    <div
      role="alert"
      data-testid="signed-download-allowlist-notice"
      className="flex flex-col gap-1 rounded-lg border border-warning/30 bg-warning-soft px-4 py-3 text-sm text-ink"
    >
      <p className="font-semibold">
        İmzalı indirme kaynakları tanımlı değil (
        <code className="font-mono text-xs">{ALLOWLIST_ENV_KEY}</code>).
      </p>
      <p className="max-w-prose">
        {subject} depodan imzalı adresle geliyorsa panel hiçbirini indiremez; kutular
        &quot;indirilemedi&quot; der. Depo origin&apos;ini bu değişkene yazıp paneli yeniden
        başlatın. Değeri bulma adımları:{" "}
        <code className="font-mono text-xs">docs/evidence-download-origins.md</code>.
      </p>
    </div>
  );
}
