import Link from "next/link";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
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
import {
  pageWindow,
  readEnumParam,
  readPaging,
  readParam,
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
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { REPORT_STATUS_TONES } from "./report-decision";

export const metadata: Metadata = { title: "Şikayetler" };

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Şikayet kuyruğu — koala-backend#199.
 *
 * Liste `AdminReportDto`. Detay ve karar `/reports/[id]` üzerinde
 * `GET /admin/reports/{id}`. Kapı kuyruğu sarar: `content.moderate` yoksa GET
 * hiç çıkmaz.
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

function readUuidParam(params: SearchParams, key: string): string | null {
  const raw = readParam(params, key);
  return raw !== null && REPORT_ID.test(raw) ? raw : null;
}

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
  const status = readEnumParam<ReportStatus>(params, "durum", REPORT_STATUSES, "OPEN");
  const paging = readPaging(params, REPORT_PAGING);
  const reportedUserId = readUuidParam(params, "kullanici");

  const viewState: Record<string, string> = {
    durum: status,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };
  if (reportedUserId !== null) viewState.kullanici = reportedUserId;

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "durum",
          label: "Durum",
          value: status,
          options: REPORT_STATUSES.map((value) => ({
            value,
            label: reportStatusLabel(value),
          })),
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
      }}
      notice={
        reportedUserId !== null ? (
          <>
            Bu görünüm bir kullanıcı hakkındaki şikayetleri süzüyor.{" "}
            <Link
              href={reportsHref({
                durum: status,
                sirala: sortParam(paging.sort),
                boyut: String(paging.size),
              })}
            >
              Süzgeci kaldır
            </Link>
            .
          </>
        ) : (
          "Durum ve sıralama kuyruğu süzer. Gelen sayfa panelde yeniden süzülmez."
        )
      }
    />
  );

  let page;
  try {
    page = await getReports(await getKoalaAccessToken(), { status, reportedUserId, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
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

      {page.content.length === 0 ? (
        <EmptyState
          title={`"${reportStatusLabel(status)}" durumunda şikayet yok.`}
          description="Bu, bu durumdaki kuyruğun boş olduğu anlamına gelir — başka durumdaki şikayetler için yukarıdaki süzgeci değiştirin."
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
              {page.content.map((report) => (
                <TableRow key={report.id}>
                  <TableCell>{formatDateTime(report.createdAt)}</TableCell>
                  <TableCell>
                    <Badge tone={REPORT_STATUS_TONES[report.status] ?? "neutral"}>
                      {reportStatusLabel(report.status)}
                    </Badge>
                  </TableCell>
                  <TableCell>{reportReasonLabel(report.reason)}</TableCell>
                  <TableCell>{reportPartyName(report.reporter)}</TableCell>
                  <TableCell>
                    {report.reportedUserId === null ? (
                      EMPTY_VALUE
                    ) : (
                      <Link
                        href={`/users/${report.reportedUserId}` as Route}
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
                    <Link
                      href={`/reports/${report.id}` as Route}
                      className="text-brand hover:underline"
                    >
                      İncele
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <QueuePager window={pageWindow(page)} state={viewState} unit="şikayet" />
        </>
      )}
    </div>
  );
}
