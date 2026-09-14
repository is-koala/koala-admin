import { isKoalaApiError } from "./errors";

/**
 * Yedi personel liste ucunun ortak `query` kuralı — koala-backend#263,
 * `core/helpers/StaffSearchQuery.java`:
 *
 * ```java
 * MIN_LENGTH = 2;  MAX_LENGTH = 100;
 * trimmed.length() > MAX_LENGTH  → ValidationException(SEARCH_QUERY_TOO_LONG)  // 400
 * trimmed.length() < MIN_LENGTH  → null                                       // süzgeç yok
 * ```
 *
 * Kural burada bir kez yazılır ki yedi istek kurucu aynı şeyi yedi kez
 * hatırlamak zorunda kalmasın. Kısa değer gönderilmez: backend zaten
 * süzmeyecekti, boş bir parametre yalnız URL'yi kirletir. Uzun değer 100'e
 * kırpılır: `?q=` bir adres çubuğundan gelir ve bir yer imi 400 olmamalı.
 * Kırpma yine de bir ret olasılığını sıfırlamaz (kodun eski bir sürümü,
 * elle yazılmış istek); {@link isSearchQueryTooLong} o cevabı tanır ki sayfa
 * genel "yüklenemedi" yerine arama kutusunun yanında Türkçe söyleyebilsin.
 *
 * Uzunluk UTF-16 birimiyle ölçülür — Java `String.length()` ile aynı ölçü.
 * Kod noktasına göre kesmek emojili bir metni backend'in gözünde 100'ün
 * üstünde bırakırdı.
 */

export const SEARCH_QUERY_MIN_LENGTH = 2;
export const SEARCH_QUERY_MAX_LENGTH = 100;

/** `AdminMessages.SEARCH_QUERY_TOO_LONG` → `KoalaException.deriveErrorCode`. */
export const SEARCH_QUERY_TOO_LONG_CODE = "ADMIN_SEARCH_QUERY_TOO_LONG";

/** Backend'in `messages_tr.properties` satırıyla aynı cümle; 400 gelirse satır içinde gösterilir. */
export const SEARCH_QUERY_TOO_LONG_MESSAGE = "Arama metni en fazla 100 karakter olabilir.";

/**
 * URL'den okunan ham metni istek kurucunun göndereceği değere çevirir.
 *
 * `undefined` dönerse `buildKoalaUrl` parametreyi hiç yazmaz.
 */
export function searchQueryParam(raw: string | null | undefined): string | undefined {
  if (raw === null || raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed.length < SEARCH_QUERY_MIN_LENGTH) return undefined;
  if (trimmed.length <= SEARCH_QUERY_MAX_LENGTH) return trimmed;

  let clipped = trimmed.slice(0, SEARCH_QUERY_MAX_LENGTH);
  // Kesim bir vekil çiftin ortasına düşerse tek kalan yüksek vekil URL'de
  // U+FFFD olur; onu düşürmek 99 karakterlik temiz bir metin bırakır.
  const last = clipped.charCodeAt(clipped.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) clipped = clipped.slice(0, -1);
  return clipped.trimEnd();
}

/**
 * Sayfanın arama kutusunda göstereceği metin: neyi aradığını operatör
 * kendi yazdığı hâliyle görür, kırpılmış hâliyle değil. `null` ise arama yok.
 */
export function readSearchQuery(raw: string | null): string | null {
  const trimmed = raw?.trim() ?? "";
  return trimmed.length === 0 ? null : trimmed;
}

/** Backend `query`'yi 100 karakteri aştığı için mi reddetti? */
export function isSearchQueryTooLong(error: unknown): boolean {
  return (
    isKoalaApiError(error) && error.status === 400 && error.errorCode === SEARCH_QUERY_TOO_LONG_CODE
  );
}
