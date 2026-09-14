import { dateRangeQuery, dateRangeState, readDateRange, type DateRange } from "@/lib/date-range";
import { DISPUTE_PAGING, type DisputeQuery } from "@/server/api/disputes";
import {
  readPaging,
  readParam,
  readUuidParam,
  type Paging,
  type SearchParams,
} from "@/server/api/paging";
import { SEARCH_PARAM, readSearchQuery } from "@/server/api/search-query";

/**
 * Uyuşmazlık listesinin görünümü; sayfa ve `/api/export/disputes` aynı
 * okuyucu (koala-admin#110). `ALL` bekleyen kuyruktur: backend'e `status`
 * gitmez ve OPEN + UNDER_REVIEW döner; `RESOLVED` kapalı arşiv.
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
  const candidate = readParam(params, "durum");
  return {
    paging: readPaging(params, DISPUTE_PAGING),
    filter: DISPUTE_STATUS_FILTERS.find((entry) => entry === candidate) ?? "ALL",
    query: readSearchQuery(readParam(params, SEARCH_PARAM)),
    userId: readUuidParam(params, "kullanici"),
    range: readDateRange(params),
  };
}

export function disputeViewState(view: DisputeView): Readonly<Record<string, string>> {
  return {
    ...(view.filter === "ALL" ? {} : { durum: view.filter }),
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
    status: view.filter === "ALL" ? null : view.filter,
    query: view.query,
    userId: view.userId,
    ...dateRangeQuery(view.range),
  };
}
