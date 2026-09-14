/**
 * Global aramanın (koala-admin#104) tarayıcı ile sunucu arasındaki sözleşmesi.
 *
 * Ağ yok, `server-only` yok: komut paleti (Client Component) ve
 * `/api/search` ucu aynı tipleri paylaşsın diye buradadır. Backend'e giden
 * hiçbir şey burada değil — o taraf `src/server/search/global-search.ts`.
 */

export const GLOBAL_SEARCH_ENDPOINT = "/api/search";

/** Tuşa basıldıkça değil, operatör durunca sorulur. */
export const GLOBAL_SEARCH_DEBOUNCE_MS = 300;

/** Metin aramasında her gruptan istenen satır sayısı. */
export const GLOBAL_SEARCH_GROUP_SIZE = 5;

/** Backend 429 döndüğünde, `Retry-After` yoksa paletin bekleyeceği süre. */
export const GLOBAL_SEARCH_DEFAULT_COOLDOWN_MS = 10_000;

/**
 * Metin aramasının grupları, ekrandaki sırayla. Her grubun kapısı ayrı bir
 * izin: sunucu izni olmayan grubu hiç istemez ve cevaba da koymaz.
 */
export const SEARCH_GROUP_KINDS = ["user", "job", "company", "assignment"] as const;
export type SearchGroupKind = (typeof SEARCH_GROUP_KINDS)[number];

export const SEARCH_GROUP_LABELS: Record<SearchGroupKind, string> = {
  user: "Kullanıcılar",
  job: "İlanlar",
  company: "Şirketler",
  assignment: "Atamalar",
};

/**
 * UUID yolunun hedefleri. Etiket, açılan nesnenin ne olduğunu paletin son
 * anda söylemesi için; sıra Promise yarışının değil, listenin sırasıdır.
 */
export const SEARCH_OBJECT_KINDS = [
  "user",
  "assignment",
  "payment",
  "payout",
  "dispute",
  "job",
  "company",
] as const;
export type SearchObjectKind = (typeof SEARCH_OBJECT_KINDS)[number];

export const SEARCH_OBJECT_LABELS: Record<SearchObjectKind, string> = {
  user: "Kullanıcı",
  assignment: "Atama",
  payment: "Ödeme denemesi",
  payout: "Hakediş",
  dispute: "Uyuşmazlık",
  job: "İlan",
  company: "Şirket",
};

export interface SearchHit {
  readonly id: string;
  /** Panel içi yol; palet `router.push` ile açar. */
  readonly href: string;
  readonly title: string;
  /** Durum, şehir, taraf adı gibi ikinci satır; yoksa `null`. */
  readonly subtitle: string | null;
}

export interface SearchGroup {
  readonly kind: SearchGroupKind;
  readonly hits: readonly SearchHit[];
  /** Backend'in saydığı toplam — "5 / 37" yazabilmek için. */
  readonly total: number;
}

/**
 * Bir grubun istenip de gelmediği durum; palet sessiz kalmasın, hangi
 * grubun cevapsız kaldığını söylesin.
 */
export interface SearchGroupFailure {
  readonly kind: SearchGroupKind;
  readonly reason: "upstream" | "too-long";
}

export type GlobalSearchResponse =
  /** Metin 2 karakterden kısa ya da boş: sorulacak bir şey yok. */
  | { readonly kind: "idle" }
  /** UUID bir nesneye denk geldi; palet doğrudan açar. */
  | { readonly kind: "object"; readonly objectKind: SearchObjectKind; readonly href: string }
  /** UUID hiçbir izinli uçta yok. */
  | { readonly kind: "not-found"; readonly probed: readonly SearchObjectKind[] }
  /** Metin araması: gruplar (boş olanlar da), cevapsız kalanlar ayrıca. */
  | {
      readonly kind: "groups";
      readonly query: string;
      readonly groups: readonly SearchGroup[];
      readonly failures: readonly SearchGroupFailure[];
    }
  /** Personelin arayabileceği tek bir uç yok. */
  | { readonly kind: "no-permission" }
  /** Backend 429 dedi; `retryAfterMs` kadar yeni istek atılmaz. */
  | { readonly kind: "rate-limited"; readonly retryAfterMs: number }
  /** Hiçbir uç cevap vermedi (5xx, ağ). */
  | { readonly kind: "unavailable" };

/** Cevabın kaba bir doğrulaması: palet `fetch`'ten dönen JSON'a güvenmez. */
export function isGlobalSearchResponse(value: unknown): value is GlobalSearchResponse {
  if (typeof value !== "object" || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return (
    kind === "idle" ||
    kind === "object" ||
    kind === "not-found" ||
    kind === "groups" ||
    kind === "no-permission" ||
    kind === "rate-limited" ||
    kind === "unavailable"
  );
}
