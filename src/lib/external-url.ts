/**
 * Backend'in serbest metin olarak verdiği bir adres (şirket web sitesi,
 * profil fotoğrafı) tarayıcıya `href`/`src` olarak yalnız `http(s)` ise gider.
 * `javascript:` ya da `data:` bir şema bağlantı olmaz, görsel çizilmez.
 *
 * `server-only` yok: yalnız metin işleme.
 */
export function httpUrlOrNull(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : null;
}
