import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { ErrorState } from "@/components/ui";
import { getDispute, getDisputeEvidence } from "@/server/api/disputes";
import { getEscrowSummary } from "@/server/api/escrow";
import { isKoalaApiError } from "@/server/api/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { SignedDownloadAllowlistNotice } from "@/server/evidence/signed-download-notice";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { DisputeDetail, type EvidenceResult, type SummaryEntry } from "../dispute-detail";

export const metadata: Metadata = { title: "Uyuşmazlık" };

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Uyuşmazlık nesne sayfası. Kanıt ve emanet burada; kuyruk yalnız listeler.
 * Kapı `dispute.resolve`: izni olmayan kişide GET /admin/disputes/{id} çıkmaz.
 */
export default async function DisputeDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Uyuşmazlık"
        description={
          <>
            Emanetteki parayı işçiye çıkarır veya işverene iade eder; kısmi iade yoktur.{" "}
            <Link href={"/disputes" as Route} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
      />

      <RequirePermission permission="dispute.resolve">
        <DisputeObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function DisputeObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!OBJECT_ID.test(id)) notFound();

  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();

  let dispute;
  try {
    dispute = await getDispute(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Uyuşmazlık detayı"
        permission="dispute.resolve"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const canReadSummaries = context.has("payment.read");
  const [entry, evidence] = await Promise.all([
    canReadSummaries
      ? loadSummary(accessToken, dispute.jobAssignmentId)
      : Promise.resolve(undefined),
    loadEvidence(accessToken, dispute.id),
  ]);

  const summaryFailed = entry !== undefined && !entry.ok;

  return (
    <div className="flex flex-col gap-6">
      <SignedDownloadAllowlistNotice subject="Kanıt dosyaları" />
      {!canReadSummaries ? (
        <ErrorState
          title="Emanet tutarlarını görüntüleme izniniz yok."
          description="Atama özeti GET /admin/job-assignments/{id} üzerinde payment.read izni ister. Panel yetkisiz bir özet isteği göndermedi; finansal kararlar kapalı, emanete dokunmayan DISMISSED kararı kullanılabilir."
          errorCode="PANEL_PERMISSION_DENIED"
        />
      ) : summaryFailed ? (
        <ErrorState
          title="Emanet tutarları okunamıyor, bu yüzden para işlemleri kapalı."
          description={
            "Uyuşmazlık kaydı tutar taşımaz; emanet rakamları GET /admin/job-assignments/{id} üzerinden payment.read ile okunur. Panel tutar uydurmayacağı için release/refund düğmeleri açılmadı; karar formunda yalnız emanete dokunmayan seçenek kullanılabilir. Backend'in cevabı: " +
            entry.failure.message
          }
          errorCode="ESCROW_SUMMARY_UNAVAILABLE"
        />
      ) : null}

      <DisputeDetail
        dispute={dispute}
        entry={entry}
        evidence={evidence}
        permissions={context.staff?.permissions ?? []}
      />
      <AuditPointer resourceId={dispute.id} linkLabel="Bu uyuşmazlığın denetim kayıtlarını aç">
        Karar ve emanet hareketleri backend tarafından bu uyuşmazlık kimliğiyle denetim kaydına
        yazılır; personelin bu kaydı açması da kayda düşer.
      </AuditPointer>
    </div>
  );
}

async function loadSummary(accessToken: string, assignmentId: string): Promise<SummaryEntry> {
  try {
    return { ok: true, summary: await getEscrowSummary(accessToken, assignmentId) };
  } catch (error) {
    return {
      ok: false,
      failure: {
        message: isKoalaApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Bilinmeyen bir hata oluştu.",
        errorCode: isKoalaApiError(error) ? error.errorCode : "UNEXPECTED",
        requestId: isKoalaApiError(error) ? error.requestId : null,
      },
    };
  }
}

async function loadEvidence(accessToken: string, disputeId: string): Promise<EvidenceResult> {
  try {
    return { ok: true, evidence: await getDisputeEvidence(accessToken, disputeId) };
  } catch (error) {
    return {
      ok: false,
      failure: {
        message: isKoalaApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Bilinmeyen bir hata oluştu.",
        errorCode: isKoalaApiError(error) ? error.errorCode : "UNEXPECTED",
        requestId: isKoalaApiError(error) ? error.requestId : null,
      },
    };
  }
}
