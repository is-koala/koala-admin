import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getReport, reportReasonLabel, reportStatusLabel } from "@/server/api/reports";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { ReportDecision, REPORT_STATUS_TONES } from "../report-decision";

export const metadata: Metadata = { title: "Şikayet" };

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Şikayet nesne sayfası. Karar ve görsel kaldırma burada; kuyruk yalnız listeler.
 * Kapı `content.moderate`: izni olmayan kişide GET /admin/reports/{id} çıkmaz.
 */
export default async function ReportDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = searchParams === undefined ? {} : await searchParams;
  const imageRemoved = readParam(query, "sonuc") === "gorsel-kaldirildi";

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Şikayet"
        description={
          <>
            Karar ve gerekçe denetim kaydına yazılır. Askıya alma yoktur.{" "}
            <Link href={"/reports" as Route} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
      />

      {imageRemoved ? (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          Görsel kaldırıldı. İlan ve şirket galerilerinden düştü.
        </p>
      ) : null}

      <RequirePermission permission="content.moderate">
        <ReportObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function ReportObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!OBJECT_ID.test(id)) notFound();

  const context = await getStaffContext();

  let detail;
  try {
    detail = await getReport(await getKoalaAccessToken(), id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Şikayet detayı"
        permission="content.moderate"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const { report, content } = detail;

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      <header className="flex flex-wrap items-center gap-2">
        <Badge tone={REPORT_STATUS_TONES[report.status] ?? "neutral"}>
          {reportStatusLabel(report.status)}
        </Badge>
        <span className="text-sm font-medium">{reportReasonLabel(report.reason)}</span>
        <span className="text-sm text-ink-muted">{formatDateTime(report.createdAt)}</span>
      </header>
      <ReportDecision
        report={report}
        content={content}
        canOpenJob={context.has("job.read")}
        canOpenAssignment={context.has("payment.read")}
      />
      <ObjectAuditPointer resourceId={report.id} linkLabel="Bu şikayetin denetim kayıtlarını aç">
        Karar ve görsel kaldırma backend tarafından bu şikayet kimliğiyle denetim kaydına yazılır;
        personelin bu kaydı açması da kayda düşer.
      </ObjectAuditPointer>
    </section>
  );
}
