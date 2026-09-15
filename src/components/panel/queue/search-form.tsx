import Link from "next/link";

import { Button, TextInput } from "@/components/ui";
import { formatInteger } from "@/lib/format";
import { listHref } from "@/lib/panel-href";
import {
  SEARCH_PARAM,
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_MIN_LENGTH,
  searchQueryParam,
} from "@/server/api/search-query";

/**
 * Liste sayfalarının ortak arama kutusu — koala-admin#94.
 *
 * Kullanıcılar sayfasındaki kalıbın aynısı, bir kez yazılmış hâli: sunucu
 * bileşeni ve `<form method="get">`. Arama `?ara=` olarak URL'de yaşar, sayfa
 * onu sunucuda okur ve backend'e `query` olarak iletir. Tarayıcıda çalışan
 * kod yok: canlı arama, debounce, fetch yok. Bu bir eksik değil bir karar —
 * bir arama sonucu biletlere yapıştırılabilen bir bağlantıdır ve JavaScript
 * kapalıyken de çalışır.
 *
 * Form yalnız `ara`'yı değiştirir. Durum süzgeci, sıralama ve sayfa boyutu
 * `state` ile gizli alan olarak taşınır ki arama, operatörün seçtiği süzgeci
 * sessizce sıfırlamasın. `sayfa` her gönderimde `0`: yeni bir aramanın
 * eski aramanın dördüncü sayfasında açılması kimsenin kastettiği şey değil.
 *
 * Enter ile gönderim tarayıcının kendi davranışıdır: tek metin alanı ve bir
 * gönder düğmesi olan bir form, Enter'da gönderilir.
 */

/**
 * Panelin tek arama parametresi. Kullanıcılar, Şirketler ve Personel
 * sayfaları zaten `?ara=` kullanıyor; yedi yeni kutu aynı adı taşır ki bir
 * operatör adres çubuğunda iki farklı sözcük öğrenmek zorunda kalmasın.
 * Sabitin evi `search-query.ts` (JSX'siz okuyucular için); buradan da çıkar.
 */
export { SEARCH_PARAM };

export interface ListSearchFormProps {
  /** Metin alanının `id`'si; sayfa başına benzersiz olmalı. */
  id: string;
  /** Erişilebilir ad: `aria-label` hem formda hem alanda budur. */
  label: string;
  /** Sayfanın kendi yolu, ör. `/assignments`; "Temizle" bağlantısı buraya döner. */
  pathname: string;
  /** URL'den okunan, kırpılmış arama; yoksa `null`. */
  query: string | null;
  /**
   * Aramanın yanında yaşaması gereken görünüm: `durum`, `sirala`, `boyut`
   * gibi. `ara` ve `sayfa` burada olsa da yok sayılır.
   */
  state?: Readonly<Record<string, string>>;
  placeholder?: string;
  /** Backend'in hangi alanlarda aradığı; operatör kutunun sınırını bilsin. */
  hint?: string;
  /** Backend aramayı reddettiyse (400) satır içinde gösterilecek Türkçe cümle. */
  error?: string | null;
}

export function ListSearchForm({
  id,
  label,
  pathname,
  query,
  state = {},
  placeholder,
  hint,
  error = null,
}: ListSearchFormProps) {
  const carried = Object.entries(state).filter(
    ([name]) => name !== SEARCH_PARAM && name !== "sayfa",
  );
  const effective = searchQueryParam(query);
  const tooShort = query !== null && effective === undefined;
  const clipped = query !== null && effective !== undefined && effective !== query;
  const hintId = hint ? `${id}-hint` : undefined;
  const noticeId = tooShort || clipped || error !== null ? `${id}-notice` : undefined;
  const describedBy = [hintId, noticeId].filter(Boolean).join(" ") || undefined;

  return (
    <form
      method="get"
      role="search"
      aria-label={label}
      className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-sm"
    >
      {carried.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <input type="hidden" name="sayfa" value="0" />

      <div className="flex flex-wrap items-center gap-3">
        <TextInput
          id={id}
          name={SEARCH_PARAM}
          type="search"
          aria-label={label}
          aria-describedby={describedBy}
          aria-invalid={error !== null || undefined}
          defaultValue={query ?? ""}
          placeholder={placeholder}
          autoComplete="off"
          maxLength={SEARCH_QUERY_MAX_LENGTH}
          className="min-w-0 flex-1"
        />
        <Button type="submit">Ara</Button>
        {query === null ? null : (
          <Link
            href={listHref(pathname, Object.fromEntries(carried))}
            className="text-sm font-medium text-brand hover:underline"
          >
            Temizle
          </Link>
        )}
      </div>

      {hint ? (
        <p id={hintId} className="max-w-prose text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}

      {error !== null ? (
        <p id={noticeId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : tooShort ? (
        <p id={noticeId} className="text-xs text-ink-muted">
          En az {SEARCH_QUERY_MIN_LENGTH} karakter yazın; daha kısa metin süzmez, liste tümüyle
          gösteriliyor.
        </p>
      ) : clipped ? (
        <p id={noticeId} className="text-xs text-ink-muted">
          Arama metni {SEARCH_QUERY_MAX_LENGTH} karaktere kırpılarak gönderildi.
        </p>
      ) : null}
    </form>
  );
}

/**
 * Backend'in gerçekten süzdüğü metin; kısa ya da boş arama için `null`.
 * Sonuç başlığı ve boş durum bunu kullanır — operatörün yazdığı bir harf,
 * "“a” için sonuç yok" diye yalan söylememeli.
 */
export function activeSearch(query: string | null): string | null {
  return searchQueryParam(query) ?? null;
}

/** Boş sonuç başlığı: `“ayşe” için sonuç yok.` */
export function searchEmptyTitle(search: string): string {
  return `“${search}” için sonuç yok.`;
}

export interface SearchResultSummaryProps {
  /** {@link activeSearch} çıktısı; `null` ise hiçbir şey çizilmez. */
  search: string | null;
  /** `PageDto.totalElements` — sayfadaki değil, backend'in saydığı toplam. */
  total: number;
  /** Tekil ad, ör. `"atama"`. */
  unit: string;
}

/**
 * Süzülmüş bir listenin üstündeki tek satır: neye göre süzüldü, kaç kayıt.
 * `role="status"` — Enter'a basan operatör sonucun geldiğini ekran
 * okuyucuda da duyar.
 *
 * Boş sonuçta çizilmez: o cümleyi sayfanın `EmptyState`'i
 * {@link searchEmptyTitle} ile zaten söylüyor; aynı satırı iki kez okutmak
 * bir şey eklemez.
 */
export function SearchResultSummary({ search, total, unit }: SearchResultSummaryProps) {
  if (search === null || total === 0) return null;
  return (
    <p role="status" className="text-sm text-ink-muted">
      {`“${search}” için ${formatInteger(total)} ${unit} bulundu.`}
    </p>
  );
}
