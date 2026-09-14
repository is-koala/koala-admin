import { dateRangeQuery, dateRangeState, readDateRange, type DateRange } from "@/lib/date-range";
import { ALL_STATUSES_PARAM } from "@/lib/panel-href";
import {
  readEnumParam,
  readPaging,
  readParam,
  readUuidParam,
  sortParam,
  type Paging,
  type SearchParams,
} from "@/server/api/paging";
import {
  REPORT_PAGING,
  REPORT_STATUSES,
  type ReportQueueQuery,
  type ReportStatus,
} from "@/server/api/reports";
import { SEARCH_PARAM, readSearchQuery } from "@/server/api/search-query";

/**
 * Şikayet listesinin görünümü; sayfa ve `/api/export/reports` aynı okuyucu
 * (koala-admin#110). `status` `null` her durumdur (`durum=hepsi`); varsayılan OPEN.
 */
export interface ReportView {
  readonly paging: Paging;
  readonly status: ReportStatus | null;
  readonly query: string | null;
  readonly reportedUserId: string | null;
  readonly reporterId: string | null;
  readonly range: DateRange;
}

export function readReportView(params: SearchParams): ReportView {
  return {
    paging: readPaging(params, REPORT_PAGING),
    status:
      readParam(params, "durum") === ALL_STATUSES_PARAM
        ? null
        : readEnumParam<ReportStatus>(params, "durum", REPORT_STATUSES, "OPEN"),
    query: readSearchQuery(readParam(params, SEARCH_PARAM)),
    reportedUserId: readUuidParam(params, "kullanici"),
    reporterId: readUuidParam(params, "sikayetci"),
    range: readDateRange(params),
  };
}

export function reportViewState(view: ReportView): Readonly<Record<string, string>> {
  return {
    durum: view.status ?? ALL_STATUSES_PARAM,
    sirala: sortParam(view.paging.sort),
    boyut: String(view.paging.size),
    ...(view.reportedUserId === null ? {} : { kullanici: view.reportedUserId }),
    ...(view.reporterId === null ? {} : { sikayetci: view.reporterId }),
    ...(view.query === null ? {} : { [SEARCH_PARAM]: view.query }),
    ...dateRangeState(view.range),
  };
}

export function reportListQuery(view: ReportView, paging: Paging = view.paging): ReportQueueQuery {
  return {
    paging,
    status: view.status,
    reportedUserId: view.reportedUserId,
    reporterId: view.reporterId,
    query: view.query,
    ...dateRangeQuery(view.range),
  };
}
