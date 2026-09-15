import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import {
  CsvExportLink,
  DateRangeFilter,
  FilterNotice,
  ListSearchForm,
  QueueFilters,
  QueueLoadFailure,
  QueuePager,
  SEARCH_PARAM,
  SearchResultSummary,
  activeSearch,
  searchEmptyTitle,
} from "@/components/panel/queue";
import { EmptyState } from "@/components/ui";
import { objectQueryFor } from "@/lib/breadcrumb";
import { dateRangeState, hasDateRange } from "@/lib/date-range";
import { ALL_STATUSES_PARAM } from "@/lib/panel-href";
import { pageWindow, sortParam, type SearchParams } from "@/server/api/paging";
import { REPORT_STATUSES, getReports, reportStatusLabel } from "@/server/api/reports";
import { SEARCH_QUERY_TOO_LONG_MESSAGE, isSearchQueryTooLong } from "@/server/api/search-query";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { readReportView, reportListQuery, reportViewState } from "@/server/lists/reports";
import { loadListFlags } from "@/server/notes/load-flags";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { ReportTable } from "./report-table";

export const metadata: Metadata = { title: "Şikayetler" };

/**
 * Şikayet kuyruğu — koala-backend#199.
 *
 * Liste `AdminReportDto`. Detay ve karar `/reports/[id]` üzerinde
 * `GET /admin/reports/{id}`. Kapı kuyruğu sarar: `content.moderate` yoksa GET
 * hiç çıkmaz.
 *
 * `?kullanici=` şikayet edilene (`reportedUserId`), `?sikayetci=` şikayet
 * edene (`reporterId`, koala-backend#283) süzer; ikisi birlikte de gider ve
 * aynı kişiyi göstermek zorunda değildir. `?durum=hepsi` backend'e `status`
 * göndermez (her durum); kullanıcı sayfasındaki sayaçlar buraya gelir.
 * `?baslangic=&bitis=` `createdAt` aralığı (koala-admin#110, koala-backend#301);
 * adres okuma `src/server/lists/reports.ts`'te, CSV rotası aynı okuyucu.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Şikayet inceleme kuyruğu"
        description={
          <>
            Mobil uygulamadan açılan kullanıcı ve içerik şikayetleri. Karar ve gerekçe denetim
            kaydına yazılır.
          </>
        }
      />

      <RequirePermission permission="content.moderate">
        <ReportQueue params={params} />
      </RequirePermission>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "status,asc", label: "Duruma göre (A-Z)" },
];

function reportsHref(
  state: Record<string, string>,
  extras: Record<string, string | null> = {},
): Route {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...state, ...extras })) {
    if (value !== null && value.length > 0) query.set(name, value);
  }
  const encoded = query.toString();
  return (encoded.length > 0 ? `/reports?${encoded}` : "/reports") as Route;
}

async function ReportQueue({ params }: { params: SearchParams }) {
  const view = readReportView(params);
  const { paging, status, query, reportedUserId, reporterId, range } = view;
  const search = activeSearch(query);

  const viewState = reportViewState(view);
  const userFiltered = reportedUserId !== null || reporterId !== null;
  const objectQuery = objectQueryFor(viewState, paging.page);

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "durum",
          label: "Durum",
          value: status ?? ALL_STATUSES_PARAM,
          options: [
            { value: ALL_STATUSES_PARAM, label: "Tümü" },
            ...REPORT_STATUSES.map((value) => ({ value, label: reportStatusLabel(value) })),
          ],
        },
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{
        boyut: String(paging.size),
        ...(reportedUserId !== null ? { kullanici: reportedUserId } : {}),
        ...(reporterId !== null ? { sikayetci: reporterId } : {}),
        ...(query !== null ? { [SEARCH_PARAM]: query } : {}),
        ...dateRangeState(range),
      }}
      notice={
        userFiltered ? (
          <FilterNotice
            inline
            testId="report-user-filter"
            clearHref={reportsHref({
              durum: status ?? ALL_STATUSES_PARAM,
              sirala: sortParam(paging.sort),
              boyut: String(paging.size),
              ...(query !== null ? { [SEARCH_PARAM]: query } : {}),
              ...dateRangeState(range),
            })}
          >
            {reportedUserId !== null && reporterId !== null
              ? "Bu görünüm şikayet edilene ve şikayet edene göre süzüyor; ikisi ayrı kişiler olabilir."
              : reporterId !== null
                ? "Bu görünüm bir kullanıcının açtığı şikayetleri süzüyor."
                : "Bu görünüm bir kullanıcı hakkındaki şikayetleri süzüyor."}
          </FilterNotice>
        ) : (
          "Durum ve sıralama kuyruğu süzer. Gelen sayfa panelde yeniden süzülmez."
        )
      }
    />
  );

  const searchForm = (error: string | null = null) => (
    <ListSearchForm
      id="sikayet-ara"
      label="Şikayetlerde ara"
      pathname="/reports"
      query={query}
      state={viewState}
      placeholder="ör. ayşe yılmaz, ayse@example.com veya garson"
      hint="Şikayet eden ve edilenin ad-soyadı ile e-postasında, ilan başlığında arar; durum süzgeciyle kesişir."
      error={error}
    />
  );

  const dateFilter = (
    <DateRangeFilter id="sikayet-tarih" pathname="/reports" range={range} state={viewState} />
  );

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getReports(accessToken, reportListQuery(view));
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return (
        <div className="flex flex-col gap-4">
          {filters}
          {searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}
          {dateFilter}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {filters}
        {searchForm()}
        {dateFilter}
        <QueueLoadFailure
          subject="Şikayet kuyruğu"
          permission="content.moderate"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {filters}
      {searchForm()}
      {dateFilter}
      <SearchResultSummary search={search} total={page.totalElements} unit="şikayet" />
      <CsvExportLink list="reports" state={viewState} unit="şikayet" />

      {page.content.length === 0 ? (
        <EmptyState
          title={
            search !== null
              ? searchEmptyTitle(search)
              : hasDateRange(range)
                ? "Bu tarih aralığında şikayet yok."
                : status === null
                  ? "Şikayet yok."
                  : `"${reportStatusLabel(status)}" durumunda şikayet yok.`
          }
          description={
            search === null
              ? "Bu, bu durumdaki kuyruğun boş olduğu anlamına gelir — başka durumdaki şikayetler için yukarıdaki süzgeci değiştirin."
              : status === null
                ? "Arama her durumda çalıştı; metni değiştirebilir ya da aramayı temizleyebilirsiniz."
                : `Arama "${reportStatusLabel(status)}" durumuyla kesişir; başka bir durum seçebilir ya da aramayı temizleyebilirsiniz.`
          }
        />
      ) : (
        <>
          <ReportTable
            reports={page.content}
            objectQuery={objectQuery}
            flagsById={await loadListFlags(
              accessToken,
              "REPORT",
              page.content.map((report) => report.id),
            )}
          />

          <QueuePager window={pageWindow(page)} state={viewState} unit="şikayet" />
        </>
      )}
    </div>
  );
}
