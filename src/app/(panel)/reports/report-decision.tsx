import Link from "next/link";

import { DecisionForm, type DecisionOption } from "@/components/panel/queue";
import { Badge, type BadgeTone } from "@/components/ui";
import { EMPTY_VALUE, formatDateTime, formatInteger } from "@/lib/format";
import { jobHref, reportsForUserHref, userHref, userHrefOrNull } from "@/lib/panel-href";
import {
  REVIEW_MIN_NOTE_LENGTH,
  reportPartyName,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
  reportTargets,
  type Report,
  type ReportContent,
} from "@/server/api/reports";

import { submitReportReview } from "./actions";
import { ImageRemovalForm } from "./image-removal-form";

export const REPORT_STATUS_TONES: Record<string, BadgeTone> = {
  OPEN: "warning",
  UNDER_REVIEW: "brand",
  ACTIONED: "danger",
  DISMISSED: "neutral",
};

/** Reviewing one of these again is a 409 from `ReportManager.review`. */
const CLOSED_STATUSES = new Set(["ACTIONED", "DISMISSED"]);

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

export function ReportDecision({
  report,
  content,
  canOpenJob = false,
}: {
  report: Report;
  content: ReportContent | null;
  /** İlan sayfası `job.read` ister; izni olmayana bağlantı 403 ekranı olurdu. */
  canOpenJob?: boolean;
}) {
  const targets = reportTargets(report);
  const closed = CLOSED_STATUSES.has(report.status);
  const hasImageTarget = targets.some((target) => target.kind === "IMAGE");
  const reporterHref = userHrefOrNull(report.reporter?.id);

  return (
    <div className="flex flex-col gap-4">
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
        <dd className="text-sm">
          {report.reporter === null ? (
            EMPTY_VALUE
          ) : reporterHref === null ? (
            reportPartyName(report.reporter)
          ) : (
            <Link href={reporterHref} className="text-brand hover:underline">
              {reportPartyName(report.reporter)}
            </Link>
          )}
        </dd>

        <dt className="text-sm text-ink-muted">Şikayet edilen</dt>
        <dd className="text-sm">
          {report.reportedUserId === null ? (
            EMPTY_VALUE
          ) : (
            <span className="flex flex-wrap gap-x-3 gap-y-1">
              <Link href={userHref(report.reportedUserId)} className="text-brand hover:underline">
                {reportPartyName(report.reportedUser)}
              </Link>
              <Link
                href={reportsForUserHref(report.reportedUserId)}
                className="text-brand hover:underline"
              >
                Bu kullanıcının şikayetleri
              </Link>
            </span>
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

        {report.jobId !== null || (content !== null && content.jobTitle !== null) ? (
          <>
            <dt className="text-sm text-ink-muted">İlan</dt>
            <dd className="text-sm">
              <JobReference
                jobId={report.jobId}
                jobTitle={content?.jobTitle ?? null}
                canOpenJob={canOpenJob}
              />
            </dd>
          </>
        ) : null}

        {report.messageId !== null ? (
          <>
            <dt className="text-sm text-ink-muted">Mesaj kimliği</dt>
            <dd className="font-mono text-xs break-all">{report.messageId}</dd>
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
        <ImageRemovalForm imageId={report.imageId} reportId={report.id} />
      ) : null}
    </div>
  );
}

/**
 * Şikayetin ilanı: başlık içerikten, kimlik şikayetten gelir. Kimlik varsa
 * mono yazılır; bağlantı yalnız `job.read` varken.
 */
function JobReference({
  jobId,
  jobTitle,
  canOpenJob,
}: {
  jobId: string | null;
  jobTitle: string | null;
  canOpenJob: boolean;
}) {
  if (jobId === null) return <>{jobTitle ?? EMPTY_VALUE}</>;
  const label = jobTitle ?? jobId;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      {canOpenJob ? (
        <Link href={jobHref(jobId)} className="text-brand hover:underline">
          {label}
        </Link>
      ) : (
        <span>{label}</span>
      )}
      {jobTitle === null ? null : <span className="font-mono text-xs break-all">{jobId}</span>}
    </span>
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
