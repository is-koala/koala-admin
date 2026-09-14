import Link from "next/link";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import {
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
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatDateTime, formatInteger } from "@/lib/format";
import { ALL_STATUSES_PARAM, reportHref, userHref, userHrefOrNull } from "@/lib/panel-href";
import {
  pageWindow,
  readEnumParam,
  readPaging,
  readParam,
  readUuidParam,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import {
  REPORT_PAGING,
  REPORT_STATUSES,
  getReports,
  reportPartyName,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
  reportTargets,
  type ReportStatus,
} from "@/server/api/reports";
import {
  SEARCH_QUERY_TOO_LONG_MESSAGE,
  isSearchQueryTooLong,
  readSearchQuery,
} from "@/server/api/search-query";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { REPORT_STATUS_TONES } from "./report-decision";

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
  const status: ReportStatus | null =
    readParam(params, "durum") === ALL_STATUSES_PARAM
      ? null
      : readEnumParam<ReportStatus>(params, "durum", REPORT_STATUSES, "OPEN");
  const paging = readPaging(params, REPORT_PAGING);
  const reportedUserId = readUuidParam(params, "kullanici");
  const reporterId = readUuidParam(params, "sikayetci");
  const query = readSearchQuery(readParam(params, SEARCH_PARAM));
  const search = activeSearch(query);

  const viewState: Record<string, string> = {
    durum: status ?? ALL_STATUSES_PARAM,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };
  if (reportedUserId !== null) viewState.kullanici = reportedUserId;
  if (reporterId !== null) viewState.sikayetci = reporterId;
  if (query !== null) viewState[SEARCH_PARAM] = query;
  const userFiltered = reportedUserId !== null || reporterId !== null;

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

  let page;
  try {
    page = await getReports(await getKoalaAccessToken(), {
      status,
      reportedUserId,
      reporterId,
      paging,
      query,
    });
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return (
        <div className="flex flex-col gap-4">
          {filters}
          {searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {filters}
        {searchForm()}
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
      <SearchResultSummary search={search} total={page.totalElements} unit="şikayet" />

      {page.content.length === 0 ? (
        <EmptyState
          title={
            search !== null
              ? searchEmptyTitle(search)
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
          <Table caption="Şikayet kuyruğu">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Tarih</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Gerekçe</TableHeaderCell>
                <TableHeaderCell>Şikayet eden</TableHeaderCell>
                <TableHeaderCell>Şikayet edilen</TableHeaderCell>
                <TableHeaderCell>Geçmiş</TableHeaderCell>
                <TableHeaderCell>Hedef</TableHeaderCell>
                <TableHeaderCell>Detay</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {page.content.map((report) => {
                const reporterHref = userHrefOrNull(report.reporter?.id);
                return (
                  <TableRow key={report.id}>
                    <TableCell>{formatDateTime(report.createdAt)}</TableCell>
                    <TableCell>
                      <Badge tone={REPORT_STATUS_TONES[report.status] ?? "neutral"}>
                        {reportStatusLabel(report.status)}
                      </Badge>
                    </TableCell>
                    <TableCell>{reportReasonLabel(report.reason)}</TableCell>
                    <TableCell>
                      {report.reporter === null ? (
                        EMPTY_VALUE
                      ) : reporterHref === null ? (
                        reportPartyName(report.reporter)
                      ) : (
                        <Link href={reporterHref} className="text-brand hover:underline">
                          {reportPartyName(report.reporter)}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      {report.reportedUserId === null ? (
                        EMPTY_VALUE
                      ) : (
                        <Link
                          href={userHref(report.reportedUserId)}
                          className="text-brand hover:underline"
                        >
                          {reportPartyName(report.reportedUser)}
                        </Link>
                      )}
                    </TableCell>
                    <TableCell>
                      {report.reportedUserId === null
                        ? EMPTY_VALUE
                        : formatInteger(report.reportedUserReportCount)}
                    </TableCell>
                    <TableCell>
                      <span className="flex flex-wrap gap-1">
                        {reportTargets(report).map((target) => (
                          <Badge key={`${target.kind}-${target.id}`}>
                            {reportTargetLabel(target.kind)}
                          </Badge>
                        ))}
                        {reportTargets(report).length === 0 ? EMPTY_VALUE : null}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Link href={reportHref(report.id)} className="text-brand hover:underline">
                        İncele
                      </Link>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>

          <QueuePager window={pageWindow(page)} state={viewState} unit="şikayet" />
        </>
      )}
    </div>
  );
}
