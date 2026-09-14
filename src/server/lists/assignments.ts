import { dateRangeQuery, dateRangeState, readDateRange, type DateRange } from "@/lib/date-range";
import {
  ASSIGNMENT_PAGING,
  ASSIGNMENT_STATUSES,
  type AssignmentQueueQuery,
  type AssignmentStatus,
} from "@/server/api/escrow";
import {
  readEnumListParam,
  readPaging,
  readParam,
  readUuidParam,
  type Paging,
  type SearchParams,
} from "@/server/api/paging";
import { SEARCH_PARAM, readSearchQuery } from "@/server/api/search-query";

/**
 * Atama listesinin görünümü: adresteki Türkçe anahtarlar bir kez okunur,
 * sayfa ve CSV rotası (`/api/export/assignments`) aynı nesneden backend
 * isteğini kurar (koala-admin#110). "Mevcut süzgeçle dışa aktar" ancak
 * iki taraf aynı okuyucuyu çağırıyorsa doğrudur; ayrı yazılsa bir gün biri
 * `durum`u okur diğeri okumaz ve CSV ekrandakinden başka bir listeyi verir.
 */
export const ASSIGNMENT_STATUS_PARAM = "durum";

export interface AssignmentView {
  readonly paging: Paging;
  readonly query: string | null;
  readonly workerId: string | null;
  readonly employerId: string | null;
  /** Boş dizi her durum: backend'e `status` gitmez. */
  readonly statuses: readonly AssignmentStatus[];
  readonly range: DateRange;
}

export function readAssignmentView(params: SearchParams): AssignmentView {
  return {
    paging: readPaging(params, ASSIGNMENT_PAGING),
    query: readSearchQuery(readParam(params, SEARCH_PARAM)),
    workerId: readUuidParam(params, "isci"),
    employerId: readUuidParam(params, "isveren"),
    statuses: readEnumListParam(params, ASSIGNMENT_STATUS_PARAM, ASSIGNMENT_STATUSES),
    range: readDateRange(params),
  };
}

/** Kimlik süzgeçleri: bildirim cümlesi ve "kaldır" bağlantıları ayrı taşır. */
export function assignmentPartyState(view: AssignmentView): Readonly<Record<string, string>> {
  return {
    ...(view.workerId === null ? {} : { isci: view.workerId }),
    ...(view.employerId === null ? {} : { isveren: view.employerId }),
  };
}

/** Süzgeçler: durum, tarih; sayfalama ve arama hariç. */
export function assignmentFilterState(view: AssignmentView): Readonly<Record<string, string>> {
  return {
    ...(view.statuses.length === 0 ? {} : { [ASSIGNMENT_STATUS_PARAM]: view.statuses.join(",") }),
    ...dateRangeState(view.range),
  };
}

/** Görünümün tamamı (`sayfa` hariç): sayfalayıcı, arama kutusu ve satır bağlantısı taşır. */
export function assignmentViewState(view: AssignmentView): Readonly<Record<string, string>> {
  return {
    boyut: String(view.paging.size),
    ...(view.query === null ? {} : { [SEARCH_PARAM]: view.query }),
    ...assignmentPartyState(view),
    ...assignmentFilterState(view),
  };
}

export function assignmentListQuery(
  view: AssignmentView,
  paging: Paging = view.paging,
): AssignmentQueueQuery {
  return {
    paging,
    query: view.query,
    workerId: view.workerId,
    employerId: view.employerId,
    status: view.statuses,
    ...dateRangeQuery(view.range),
  };
}
