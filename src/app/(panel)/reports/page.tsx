import Link from "next/link";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import {
  DecisionForm,
  QueueFilters,
  QueueLoadFailure,
  QueuePager,
  type DecisionOption,
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
  type BadgeTone,
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
  REVIEW_MIN_NOTE_LENGTH,
  getReport,
  getReports,
  reportPartyName,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
  reportTargets,
  type Report,
  type ReportContent,
  type ReportStatus,
} from "@/server/api/reports";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitReportReview } from "./actions";
import { ImageRemovalForm } from "./image-removal-form";

export const metadata: Metadata = { title: "Şikayetler" };

const REPORT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Şikayet kuyruğu — koala-backend#199.
 *
 * Liste `AdminReportDto`: muhbir, şikayet edilen, kuyruğun tamamı üzerinden
 * geçmiş sayı. İçerik önizlemesi yalnız `GET /admin/reports/{id}` üzerinde;
 * `?id=` o ucu çağırır, sayfa numarasına bağlı bir yer işareti değildir.
 *
 * Kapı kuyruğu sarar: `content.moderate` yoksa GET hiç çıkmaz.
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
            Mobil uygulamadan açılan kullanıcı ve içerik şikayetleri.{" "}
            <code className="font-mono">content.moderate</code> izni gerektirir. Karar veren
            personel ve karar zamanı backend&apos;in denetim kaydına yazılır (koala-backend#15).
          </>
        }
      />

      <RequirePermission permission="content.moderate">
        <ReportQueue params={params} />
      </RequirePermission>
    </div>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  OPEN: "warning",
  UNDER_REVIEW: "brand",
  ACTIONED: "danger",
  DISMISSED: "neutral",
};

/** Reviewing one of these again is a 409 from `ReportManager.review`. */
const CLOSED_STATUSES = new Set(["ACTIONED", "DISMISSED"]);

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
  const selectedId = readUuidParam(params, "id");

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

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getReports(accessToken, { status, reportedUserId, paging });
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

  let selectedContent: ReportContent | null = null;
  let selectedOffPage: Report | null = null;
  let selectedFailure = null;
  if (selectedId !== null) {
    try {
      const detail = await getReport(accessToken, selectedId);
      selectedContent = detail.content;
      if (!page.content.some((report) => report.id === selectedId)) {
        selectedOffPage = detail.report;
      }
    } catch (error) {
      selectedFailure = error;
    }
  }

  const reports = selectedOffPage === null ? page.content : [selectedOffPage, ...page.content];

  return (
    <div className="flex flex-col gap-6">
      {filters}

      {selectedFailure !== null ? (
        <QueueLoadFailure
          subject="Şikayet detayı"
          permission="content.moderate"
          failure={classifyQueueFailure(selectedFailure)}
        />
      ) : null}

      {page.content.length === 0 && selectedOffPage === null ? (
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
              {reports.map((report) => (
                <TableRow key={report.id}>
                  <TableCell>{formatDateTime(report.createdAt)}</TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONES[report.status] ?? "neutral"}>
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
                        href={reportsHref(viewState, {
                          kullanici: report.reportedUserId,
                          id: null,
                        })}
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
                      href={reportsHref(viewState, { id: report.id, sayfa: String(paging.page) })}
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

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Şikayet detayları ve kararlar</h2>
            {reports.map((report) => (
              <ReportDetail
                key={report.id}
                report={report}
                viewState={viewState}
                open={selectedId === report.id}
                content={selectedId === report.id ? selectedContent : null}
              />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

function decisionOptions(): DecisionOption[] {
  return [
    {
      value: "ACTIONED",
      label: "Haklı bulundu",
      consequence:
        "Şikayet haklı bulunmuş olarak kapanır ve gerekçeniz kayda geçer. Askıya alma ya da içerik kaldırma bu kararla birlikte yapılmaz — o adımlar ayrıdır.",
      irreversible: true,
    },
    {
      value: "DISMISSED",
      label: "Haksız bulundu",
      consequence:
        "Şikayet reddedilmiş olarak kapanır ve gerekçeniz kayda geçer. Şikayet edilen hakkında hiçbir işlem yapılmaz.",
      irreversible: true,
    },
    {
      value: "UNDER_REVIEW",
      label: "Ek bilgi bekleniyor",
      consequence:
        "Şikayet kapanmaz; 'İncelemede' olarak işaretlenir ve bu durumdaki kuyrukta görünmeye devam eder. Sonradan haklı ya da haksız kararı verilebilir.",
    },
  ];
}

function ReportDetail({
  report,
  viewState,
  open,
  content,
}: {
  report: Report;
  viewState: Record<string, string>;
  open: boolean;
  content: ReportContent | null;
}) {
  const targets = reportTargets(report);
  const closed = CLOSED_STATUSES.has(report.status);
  const hasImageTarget = targets.some((target) => target.kind === "IMAGE");

  return (
    <details
      id={`sikayet-${report.id}`}
      open={open || undefined}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span className="font-mono text-xs text-ink-subtle">{report.id.slice(0, 8)}</span>
        <Badge tone={STATUS_TONES[report.status] ?? "neutral"}>
          {reportStatusLabel(report.status)}
        </Badge>
        <span>{reportReasonLabel(report.reason)}</span>
        <span className="text-ink-muted">{formatDateTime(report.createdAt)}</span>
        {report.reportedUserId !== null && report.reportedUserReportCount > 0 ? (
          <Badge tone={report.reportedUserReportCount > 1 ? "warning" : "neutral"}>
            Geçmiş şikayet {formatInteger(report.reportedUserReportCount)}
          </Badge>
        ) : null}
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-ink-muted">Şikayet kimliği</dt>
          <dd className="font-mono text-sm break-all">{report.id}</dd>

          <dt className="text-sm text-ink-muted">Açılma zamanı</dt>
          <dd className="text-sm">{formatDateTime(report.createdAt)}</dd>

          <dt className="text-sm text-ink-muted">Gerekçe</dt>
          <dd className="text-sm">{reportReasonLabel(report.reason)}</dd>

          <dt className="text-sm text-ink-muted">Şikayet metni</dt>
          <dd className="text-sm whitespace-pre-wrap">{report.description ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Şikayet eden</dt>
          <dd className="text-sm">{reportPartyName(report.reporter)}</dd>

          <dt className="text-sm text-ink-muted">Şikayet edilen</dt>
          <dd className="text-sm">
            {report.reportedUserId === null ? (
              EMPTY_VALUE
            ) : (
              <Link
                href={reportsHref(viewState, { kullanici: report.reportedUserId, id: null })}
                className="text-brand hover:underline"
              >
                {reportPartyName(report.reportedUser)}
              </Link>
            )}
          </dd>

          <dt className="text-sm text-ink-muted">Geçmiş şikayet</dt>
          <dd className="text-sm">
            {report.reportedUserId === null
              ? EMPTY_VALUE
              : `${formatInteger(report.reportedUserReportCount)} (kuyruğun tamamı)`}
          </dd>

          <dt className="text-sm text-ink-muted">Hedef</dt>
          <dd className="flex flex-col gap-1 text-sm">
            {targets.length === 0 ? EMPTY_VALUE : null}
            {targets.map((target) => (
              <span key={`${target.kind}-${target.id}`} className="flex items-center gap-2">
                <Badge>{reportTargetLabel(target.kind)}</Badge>
                <span className="font-mono text-xs break-all">{target.id}</span>
              </span>
            ))}
          </dd>

          {content !== null && content.jobTitle !== null ? (
            <>
              <dt className="text-sm text-ink-muted">İlan</dt>
              <dd className="text-sm">{content.jobTitle}</dd>
            </>
          ) : null}

          {content !== null && content.messageBody !== null ? (
            <>
              <dt className="text-sm text-ink-muted">Mesaj</dt>
              <dd className="text-sm whitespace-pre-wrap">{content.messageBody}</dd>
            </>
          ) : null}

          {content !== null && content.imageUrl !== null ? (
            <>
              <dt className="text-sm text-ink-muted">Görsel</dt>
              <dd>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={content.imageUrl}
                  alt="Şikayet edilen görsel"
                  className="max-h-64 rounded-lg border border-border-subtle"
                />
              </dd>
            </>
          ) : null}

          {report.reviewedBy !== null ? (
            <>
              <dt className="text-sm text-ink-muted">Kararı veren</dt>
              <dd className="text-sm">{reportPartyName(report.reviewedBy)}</dd>
            </>
          ) : null}

          {report.reviewNote === null && report.reviewedAt === null ? null : (
            <>
              <dt className="text-sm text-ink-muted">Önceki karar notu</dt>
              <dd className="text-sm whitespace-pre-wrap">{report.reviewNote ?? EMPTY_VALUE}</dd>

              <dt className="text-sm text-ink-muted">Karar zamanı</dt>
              <dd className="text-sm">{formatDateTime(report.reviewedAt)}</dd>
            </>
          )}
        </dl>

        <DecisionForm
          action={submitReportReview}
          hiddenFields={{ reportId: report.id }}
          options={decisionOptions()}
          legend="Karar"
          noteLabel="Karar gerekçesi"
          noteHint={`En az ${REVIEW_MIN_NOTE_LENGTH} karakter.`}
          submitLabel="Kararı gönder"
          minNoteLength={REVIEW_MIN_NOTE_LENGTH}
          idPrefix={`sikayet-${report.id}`}
          disabled={closed}
          disabledReason={`Bu şikayet "${reportStatusLabel(report.status)}" olarak sonuçlandırılmış. Backend sonuçlanmış bir şikayeti tekrar sonuçlandırmıyor (409).`}
          followUp={<FollowUp hasImageTarget={hasImageTarget} />}
        />

        {hasImageTarget && report.imageId !== null ? (
          <ImageRemovalForm imageId={report.imageId} />
        ) : null}
      </div>
    </details>
  );
}

function FollowUp({ hasImageTarget }: { hasImageTarget: boolean }) {
  return (
    <p className="text-sm text-ink-muted">
      {hasImageTarget
        ? "Bu karar görseli kendiliğinden silmez ve hesabı kapatmaz. Görseli aşağıdan kaldırabilirsiniz."
        : "Bu karar içeriği kaldırmaz ve hesabı kapatmaz. Karar denetim kaydına düşer."}
    </p>
  );
}
