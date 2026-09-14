import { dateRangeQuery, dateRangeState, readDateRange, type DateRange } from "@/lib/date-range";
import { ALL_STATUSES_PARAM } from "@/lib/panel-href";
import {
  readPaging,
  readParam,
  readUuidParam,
  type Paging,
  type SearchParams,
} from "@/server/api/paging";
import {
  PAYOUT_PAGING,
  PAYOUT_STATUSES,
  type PayoutQueueQuery,
} from "@/server/api/payout-reconciliation";
import { SEARCH_PARAM, readSearchQuery } from "@/server/api/search-query";

/**
 * Hakediş listesinin görünümü; sayfa ve `/api/export/payouts` aynı okuyucu
 * (koala-admin#110). `durum=hepsi` dört durumu birden gönderir, yoksa backend
 * PROCESSING varsayılanına düşer (koala-admin#100/#106).
 */
export interface PayoutView {
  readonly paging: Paging;
  readonly query: string | null;
  readonly workerId: string | null;
  readonly allStatuses: boolean;
  readonly range: DateRange;
}

export function readPayoutView(params: SearchParams): PayoutView {
  return {
    paging: readPaging(params, PAYOUT_PAGING),
    query: readSearchQuery(readParam(params, SEARCH_PARAM)),
    workerId: readUuidParam(params, "isci"),
    allStatuses: readParam(params, "durum") === ALL_STATUSES_PARAM,
    range: readDateRange(params),
  };
}

export function payoutFilterState(view: PayoutView): Readonly<Record<string, string>> {
  return {
    ...(view.allStatuses ? { durum: ALL_STATUSES_PARAM } : {}),
    ...dateRangeState(view.range),
  };
}

export function payoutViewState(view: PayoutView): Readonly<Record<string, string>> {
  return {
    boyut: String(view.paging.size),
    ...(view.query === null ? {} : { [SEARCH_PARAM]: view.query }),
    ...(view.workerId === null ? {} : { isci: view.workerId }),
    ...payoutFilterState(view),
  };
}

export function payoutListQuery(view: PayoutView, paging: Paging = view.paging): PayoutQueueQuery {
  return {
    paging,
    query: view.query,
    workerId: view.workerId,
    status: view.allStatuses ? PAYOUT_STATUSES : null,
    ...dateRangeQuery(view.range),
  };
}
