/**
 * İndirme BFF'lerinin (kimlik fotoğrafı, şirket galerisi, uyuşmazlık kanıtı)
 * tarayıcıya söylediği neden. Bu dosya bilerek sunucu katmanına dokunmaz:
 * hem Route Handler hem `"use client"` fotoğraf kutusu import eder.
 *
 * Bir `img` `onError` içinde yanıt başlığını göremez; kırık görselden "yetki
 * yok" ile "depo origin'i izin listesinde değil" ayırt edilemez. Bu yüzden BFF
 * 502'ye makineye okunur bir başlık ekler ve istemci hata sonrası aynı adrese
 * `HEAD` atıp başlığı okur (koala-admin#93).
 */
export const DOWNLOAD_ERROR_HEADER = "X-Koala-Download-Error";

/** `EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS`; günlük satırı ve personel metni aynı adı söyler. */
export const ALLOWLIST_ENV_KEY = "EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS";

export const DOWNLOAD_ERROR_REASONS = ["origin_not_allowed", "not_configured", "upstream"] as const;

export type DownloadErrorReason = (typeof DOWNLOAD_ERROR_REASONS)[number];

export function parseDownloadErrorReason(value: string | null): DownloadErrorReason | null {
  return (DOWNLOAD_ERROR_REASONS as readonly string[]).includes(value ?? "")
    ? (value as DownloadErrorReason)
    : null;
}

/**
 * Fotoğraf kutusunun ayırdığı durumlar. `unknown`, teşhis isteğinin kendisi
 * başarısız olduğunda ya da 502'yi BFF değil önündeki proxy ürettiğinde
 * (başlık yok) kalan genel metin.
 */
export type PhotoLoadFailure =
  "not_found" | "not_configured" | "origin_not_allowed" | "upstream" | "unknown";

export function classifyDownloadResponse(
  status: number,
  reasonHeader: string | null,
): PhotoLoadFailure {
  if (status === 404) return "not_found";
  if (status === 502) return parseDownloadErrorReason(reasonHeader) ?? "unknown";
  return "unknown";
}

/**
 * 404 ile 502 farklı cümle; 502 içinde yapılandırma ile depo farklı cümle.
 * "Bu kutu onaylanmış bir fotoğraf değildir." kutuda ayrıca durur, buraya
 * eklenmez: onay kararı için önemli olan o cümle her durumda görünmeli.
 */
export const PHOTO_LOAD_FAILURE_TEXT: Record<PhotoLoadFailure, string> = {
  not_found: "Fotoğraf bulunamadı ya da bu kayda erişiminiz yok.",
  not_configured: `Depo indirme kaynağı tanımlı değil (${ALLOWLIST_ENV_KEY}). Sunucu günlüğüne bakın.`,
  origin_not_allowed: `Depo indirme kaynağı izin listesinde yok (${ALLOWLIST_ENV_KEY}). Sunucu günlüğü doğru origin'i yazar.`,
  upstream: "Depo yanıt vermedi; tekrar deneyin.",
  unknown: "İndirme veya görüntüleme başarısız oldu.",
};

/**
 * Kırık `img`'den sonra aynı adrese `HEAD`. Next `HEAD`'i `GET`'e bağlar,
 * yani BFF aynı yoldan geçer ve aynı başlığı üretir; gövde tarayıcıya inmez.
 * Ağ hatası da bir cevaptır: genel metin.
 */
export async function diagnoseDownload(
  src: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PhotoLoadFailure> {
  try {
    const response = await fetchImpl(src, {
      method: "HEAD",
      cache: "no-store",
      credentials: "same-origin",
    });
    return classifyDownloadResponse(response.status, response.headers.get(DOWNLOAD_ERROR_HEADER));
  } catch {
    return "unknown";
  }
}
