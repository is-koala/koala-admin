import type { Metadata } from "next";

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
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import {
  REPORT_PAGING,
  REPORT_STATUSES,
  REVIEW_MIN_NOTE_LENGTH,
  getReports,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
  reportTargets,
  type Report,
  type ReportStatus,
} from "@/server/api/reports";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitReportReview } from "./actions";
import { ImageRemovalForm } from "./image-removal-form";

export const metadata: Metadata = { title: "Şikayetler" };

/**
 * The screen koala mobile has been missing since is-koala/koala#36 merged.
 *
 * Users have been able to report each other and each other's content for a
 * while; nothing in koala-admin could look at what they filed. This is the
 * operator behind that promise.
 *
 * Two structural notes, both forced by `ReportsController`:
 *
 *  - **One status at a time.** `@RequestParam ReportStatus status` is required,
 *    so there is no combined view and no "all". The filter is a real request
 *    parameter, which is the only way it could be honest with `PageDto`.
 *  - **Detail is not a separate page.** There is no `GET /admin/reports/{id}`,
 *    so a `/reports/[id]` route could only find a report by walking pages —
 *    which would make a bookmarked link depend on how many reports were filed
 *    after it. The detail opens from the row the queue already fetched.
 *
 * The gate wraps the queue element rather than the page, so a staff member
 * without `content.moderate` gets the 403 state and `GET /admin/reports` is
 * never called. `reports.test.tsx` asserts that as a request count.
 */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  // Reading the URL is not a backend call, so doing it above the gate costs
  // nothing and keeps the gated child a single element.
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

async function ReportQueue({ params }: { params: SearchParams }) {
  const status = readEnumParam<ReportStatus>(params, "durum", REPORT_STATUSES, "OPEN");
  const paging = readPaging(params, REPORT_PAGING);

  /** Everything that describes this view, minus the page number. */
  const viewState = {
    durum: status,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };

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
      carry={{ boyut: String(paging.size) }}
      notice="Durum ve sıralama kuyruğu süzer. Gelen sayfa panelde yeniden süzülmez."
    />
  );

  let page;
  try {
    page = await getReports(await getKoalaAccessToken(), { status, paging });
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

  const reports = page.content;
  /**
   * How many rows *on this page* name the same reported user.
   *
   * Deliberately page-scoped, and said in those words everywhere it appears.
   * Real grouping needs a filter by reported user, which the endpoint does not
   * have; a number computed from twenty rows and presented as a total would be
   * a lie an operator would act on.
   */
  const repeatsOnPage = new Map<string, number>();
  for (const report of reports) {
    if (report.reportedUserId !== null) {
      repeatsOnPage.set(report.reportedUserId, (repeatsOnPage.get(report.reportedUserId) ?? 0) + 1);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {filters}

      {reports.length === 0 ? (
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
                <TableHeaderCell>Hedef</TableHeaderCell>
                <TableHeaderCell>Açıklama</TableHeaderCell>
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
                  <TableCell className="max-w-72 truncate">
                    {report.description ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell>
                    <a href={`#sikayet-${report.id}`} className="text-brand hover:underline">
                      İncele
                    </a>
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
                repeatsOnPage={
                  report.reportedUserId === null
                    ? 1
                    : (repeatsOnPage.get(report.reportedUserId) ?? 1)
                }
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

function ReportDetail({ report, repeatsOnPage }: { report: Report; repeatsOnPage: number }) {
  const targets = reportTargets(report);
  const closed = CLOSED_STATUSES.has(report.status);
  const hasImageTarget = targets.some((target) => target.kind === "IMAGE");

  return (
    <details
      id={`sikayet-${report.id}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span className="font-mono text-xs text-ink-subtle">{report.id.slice(0, 8)}</span>
        <Badge tone={STATUS_TONES[report.status] ?? "neutral"}>
          {reportStatusLabel(report.status)}
        </Badge>
        <span>{reportReasonLabel(report.reason)}</span>
        <span className="text-ink-muted">{formatDateTime(report.createdAt)}</span>
        {repeatsOnPage > 1 ? (
          <Badge tone="warning">Aynı kullanıcı bu sayfada {formatInteger(repeatsOnPage)} kez</Badge>
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

          <dt className="text-sm text-ink-muted">Şikayet eden</dt>
          <dd className="text-sm">{EMPTY_VALUE}</dd>

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

/**
 * What has to happen after a verdict, and what the panel cannot do about it.
 *
 * koala-admin#7 asks for the follow-up steps to be on screen, with a link where
 * an endpoint exists and a plain "out of scope" where one does not. Both halves
 * are true here and neither is invented: there is no suspension endpoint
 * anywhere in koala-backend, and content removal exists for images only.
 */
function FollowUp({ hasImageTarget }: { hasImageTarget: boolean }) {
  return (
    <p className="text-sm text-ink-muted">
      {hasImageTarget
        ? "Bu karar görseli kendiliğinden silmez ve hesabı kapatmaz. Görseli aşağıdan kaldırabilirsiniz."
        : "Bu karar içeriği kaldırmaz ve hesabı kapatmaz. Karar denetim kaydına düşer."}
    </p>
  );
}
