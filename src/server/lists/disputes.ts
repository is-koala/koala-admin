import { dateRangeQuery, dateRangeState, readDateRange, type DateRange } from "@/lib/date-range";
import { DISPUTE_PAGING, type DisputeQuery } from "@/server/api/disputes";
import {
  readEnumParam,
  readPaging,
  readParam,
  readUuidParam,
  sortParam,
  type Paging,
  type SearchParams,
} from "@/server/api/paging";
import { SEARCH_PARAM, readSearchQuery } from "@/server/api/search-query";

/**
 * Uyuşmazlık listesinin görünümü; sayfa ve `/api/export/disputes` aynı
 * okuyucu (koala-admin#110). `ALL` bekleyen kuyruktur: backend'e `status`
 * gitmez ve OPEN + UNDER_REVIEW döner; `RESOLVED` kapalı arşiv. `?sirala=`
 * `DISPUTE_PAGING.sortable` içinden (`createdAt`); ev karosunun "eskiden
 * yeniye" bağlantısı sayfalama ve süzgeç geçişlerinde korunur (koala-admin#111).
 */
export const DISPUTE_STATUS_FILTERS = ["ALL", "OPEN", "UNDER_REVIEW", "RESOLVED"] as const;

export type DisputeStatusFilter = (typeof DISPUTE_STATUS_FILTERS)[number];

export interface DisputeView {
  readonly paging: Paging;
  readonly filter: DisputeStatusFilter;
  readonly query: string | null;
  readonly userId: string | null;
  readonly range: DateRange;
}

export function readDisputeView(params: SearchParams): DisputeView {
  return {
    paging: readPaging(params, DISPUTE_PAGING),
    filter: readEnumParam(params, "durum", DISPUTE_STATUS_FILTERS, "ALL"),
    query: readSearchQuery(readParam(params, SEARCH_PARAM)),
    userId: readUuidParam(params, "kullanici"),
    range: readDateRange(params),
  };
}

export function disputeViewState(view: DisputeView): Readonly<Record<string, string>> {
  return {
    ...(view.filter === "ALL" ? {} : { durum: view.filter }),
    sirala: sortParam(view.paging.sort),
    boyut: String(view.paging.size),
    ...(view.query === null ? {} : { [SEARCH_PARAM]: view.query }),
    ...(view.userId === null ? {} : { kullanici: view.userId }),
    ...dateRangeState(view.range),
  };
}

export function disputeListQuery(
  view: DisputeView,
  paging: { page: number; size: number } = view.paging,
): DisputeQuery {
  return {
    page: paging.page,
    size: paging.size,
    sort: view.paging.sort,
    status: view.filter === "ALL" ? null : view.filter,
    query: view.query,
    userId: view.userId,
    ...dateRangeQuery(view.range),
  };
}
