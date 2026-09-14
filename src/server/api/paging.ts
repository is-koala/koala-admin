import { isUuid } from "@/lib/panel-href";

import type { PageDto } from "./types";

/**
 * The one place a URL turns into Spring's `Pageable` query parameters.
 *
 * Both moderation queues (koala-admin#7, #8) page and sort on the *server*.
 * That is not a preference: `GET /admin/reports` and `GET /admin/companies`
 * return one `PageDto` page at a time, so anything the panel did to a returned
 * page would be a filter over twenty rows presented as a filter over the queue.
 * An operator who sorts by date and sees the twenty newest of *page three* has
 * been lied to, and the lie is invisible.
 *
 * So this module exists to make "the filter goes to the server" a thing that is
 * written down once and tested once, rather than remembered twice.
 *
 * The other half of its job is staying inside what the backend accepts.
 * `core/helpers/PageableSanitizer.java` does two different things with a sort:
 * `sanitize()` quietly drops unknown fields, but `rejectUnknownSort()` — which
 * both of our endpoints call *first* — throws a validation error. So a stray
 * `?sort=email` in the address bar is a 400, not a fallback, unless something
 * drops it before the request is built. {@link readPaging} is that something.
 */

/** `PageableSanitizer.MAX_PAGE_SIZE`. Asking for more is silently reduced. */
export const MAX_PAGE_SIZE = 100;

/** `@PageableDefault(size = 20)` on both controller methods. */
export const DEFAULT_PAGE_SIZE = 20;

export type SortDirection = "asc" | "desc";

export interface SortSpec {
  /** Entity property name, exactly as the backend's `SORTABLE` set spells it. */
  readonly field: string;
  readonly direction: SortDirection;
}

/**
 * What one endpoint permits. Copied from the backend's own constants — see
 * `ReportManager.SORTABLE` and `CompanyManager.COMPANY_SORTABLE` — because a
 * field that is not in that set is a 400 rather than a degraded result.
 */
export interface PagingContract {
  readonly sortable: readonly string[];
  readonly defaultSort: SortSpec;
  readonly defaultSize?: number;
}

export interface Paging {
  /** Zero-based, like `PageDto.page`. */
  readonly page: number;
  readonly size: number;
  readonly sort: SortSpec;
}

export type SearchParamValue = string | string[] | undefined;

/** Next.js hands `searchParams` in this shape; a repeated key arrives as an array. */
export type SearchParams = Readonly<Record<string, SearchParamValue>>;

/**
 * First value for a key, or `null`.
 *
 * `?status=OPEN&status=ACTIONED` is not an error worth a screen — the backend
 * would bind the first one anyway — but it must not reach a comparison as an
 * array and quietly match nothing.
 */
export function readParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "string" && first.length > 0 ? first : null;
}

/**
 * Read a value that has to be one of a closed set, e.g. a `ReportStatus`.
 *
 * Anything else falls back rather than travelling on: Spring answers a bad enum
 * value with a 400, so `?status=banana` would otherwise turn a bookmark into an
 * error page.
 */
export function readEnumParam<T extends string>(
  params: SearchParams,
  key: string,
  allowed: readonly T[],
  fallback: T,
): T {
  const raw = readParam(params, key);
  return raw !== null && (allowed as readonly string[]).includes(raw) ? (raw as T) : fallback;
}

/**
 * Bir kimlik süzgeci (`?isci=`, `?sirket=`, `?kullanici=`): UUID değilse
 * `null`. Yanlış biçim backend'e gitmez — Spring `UUID` bağlayamayınca 400
 * dönerdi ve bir yer imi hata sayfasına dönüşürdü; kuyruk süzgeçsiz açılır.
 */
export function readUuidParam(params: SearchParams, key: string): string | null {
  const raw = readParam(params, key)?.trim() ?? "";
  return raw.length > 0 && isUuid(raw) ? raw : null;
}

/** `?onaylandi=true` → `true`. Anything that is not exactly `true` is `false`. */
export function readBooleanParam(params: SearchParams, key: string, fallback: boolean): boolean {
  const raw = readParam(params, key);
  if (raw === null) return fallback;
  return raw === "true";
}

/** `"createdAt,desc"` — the shape Spring's `SortHandlerMethodArgumentResolver` reads. */
export function sortParam(sort: SortSpec): string {
  return `${sort.field},${sort.direction}`;
}

/** Parse `"createdAt,desc"`, keeping only fields the endpoint actually sorts on. */
export function parseSort(raw: string | null, contract: PagingContract): SortSpec {
  if (raw === null) return contract.defaultSort;

  const [field, direction] = raw.split(",");

  if (field === undefined || !contract.sortable.includes(field)) {
    return contract.defaultSort;
  }

  return { field, direction: direction === "asc" ? "asc" : "desc" };
}

/**
 * Turn a URL into a request the backend will accept.
 *
 * Every value is clamped here rather than trusted, because every one of them is
 * typed by a person into an address bar at some point: `page=-1` is a 400 from
 * `PageRequest.of`, `size=5000` is silently reduced by the sanitizer (so the UI
 * and the response would disagree about the page size), and an unknown sort
 * field is a rejected request.
 */
export function readPaging(params: SearchParams, contract: PagingContract): Paging {
  const requestedPage = Number(readParam(params, "sayfa") ?? 0);
  const requestedSize = Number(
    readParam(params, "boyut") ?? contract.defaultSize ?? DEFAULT_PAGE_SIZE,
  );

  const page = Number.isFinite(requestedPage) ? Math.max(0, Math.trunc(requestedPage)) : 0;
  const size = Number.isFinite(requestedSize)
    ? Math.min(MAX_PAGE_SIZE, Math.max(1, Math.trunc(requestedSize)))
    : (contract.defaultSize ?? DEFAULT_PAGE_SIZE);

  return { page, size, sort: parseSort(readParam(params, "sirala"), contract) };
}

/**
 * The query parameters for one page.
 *
 * Named `sort` rather than `sirala` on purpose — the panel's URLs are Turkish
 * because operators read them; the backend's contract is not, and translating
 * at exactly one boundary is what keeps both true.
 */
export function pagingQuery(paging: Paging): { page: number; size: number; sort: string } {
  return { page: paging.page, size: paging.size, sort: sortParam(paging.sort) };
}

/** The parts of a `PageDto` a pager needs, with nothing else along for the ride. */
export interface PageWindow {
  readonly page: number;
  readonly size: number;
  readonly totalElements: number;
  readonly totalPages: number;
  readonly first: boolean;
  readonly last: boolean;
}

export function pageWindow<T>(page: PageDto<T>): PageWindow {
  return {
    page: page.page,
    size: page.size,
    totalElements: page.totalElements,
    totalPages: page.totalPages,
    first: page.first,
    last: page.last,
  };
}
