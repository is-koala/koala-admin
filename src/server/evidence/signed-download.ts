import { env } from "@/env";
import { ALLOWLIST_ENV_KEY, type DownloadErrorReason } from "@/lib/evidence-download";

export type SignedDownloadDecision =
  | { readonly ok: true; readonly url: string }
  | { readonly ok: false; readonly reason: DownloadErrorReason };

/**
 * Backend'in 302 ile verdiği imzalı depo adresini sunucu takip etsin mi?
 *
 * Üç indirme BFF'i aynı kararı verir ve eskiden hepsi sessizdi: liste boşken
 * ya da S3 origin'i eşleşmezken personel yalnız "indirilemedi" görüyor,
 * günlüğe hiçbir şey düşmüyordu (koala-admin#93). Şimdi ret bir `console.warn`
 * satırı ve bir neden taşır; rota nedeni `X-Koala-Download-Error` başlığına
 * yazar, fotoğraf kutusu da onu okur.
 *
 * Günlüğe **yalnız origin** gider. Yol ve sorgu imzayı taşır; günlük dosyası
 * kısa ömürlü de olsa o imza için doğru yer değil.
 */
export function allowedSignedDownload(
  location: string | null,
  allowedOrigins: readonly string[] = env.EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS,
): SignedDownloadDecision {
  if (location === null || !URL.canParse(location)) {
    console.warn("evidence download redirect refused: backend sent no usable Location on the 302");
    return { ok: false, reason: "upstream" };
  }

  const url = new URL(location);
  if (url.username.length > 0 || url.password.length > 0) {
    console.warn(
      `evidence download redirect refused: signed URL for ${url.origin} carries credentials`,
    );
    return { ok: false, reason: "upstream" };
  }

  if (allowedOrigins.length === 0) {
    console.warn(
      `evidence download allowlist is empty: ${ALLOWLIST_ENV_KEY} is not set, so the signed redirect to ${url.origin} was refused (set ${ALLOWLIST_ENV_KEY}=${url.origin} and restart the panel)`,
    );
    return { ok: false, reason: "not_configured" };
  }

  if (!allowedOrigins.includes(url.origin)) {
    console.warn(
      `evidence download origin not allowed: ${url.origin} (add it to ${ALLOWLIST_ENV_KEY}, comma-separated, and restart the panel)`,
    );
    return { ok: false, reason: "origin_not_allowed" };
  }

  return { ok: true, url: url.toString() };
}
