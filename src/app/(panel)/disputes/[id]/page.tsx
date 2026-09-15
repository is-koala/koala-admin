import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { StaffNotesSection } from "@/components/panel/staff-notes";
import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { ObjectTimeline } from "@/components/panel/object-timeline";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { ErrorState } from "@/components/ui";
import { objectBreadcrumb, readQueueState } from "@/lib/breadcrumb";
import { TimelineBuilder, type TimelineEvent } from "@/lib/object-timeline";
import {
  disputeResolutionSpec,
  disputeSideLabel,
  getDispute,
  getDisputeEvidence,
  type Dispute,
  type DisputeEvidence,
} from "@/server/api/disputes";
import { getEscrowSummary } from "@/server/api/escrow";
import { isKoalaApiError } from "@/server/api/errors";
import type { SearchParams } from "@/server/api/paging";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { SignedDownloadAllowlistNotice } from "@/server/evidence/signed-download-notice";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";
import { resolveStaffRefs } from "@/server/staff/staff-refs";

import { DisputeDetail, type EvidenceResult, type SummaryEntry } from "../dispute-detail";

export const metadata: Metadata = { title: "Uyuşmazlık" };

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Uyuşmazlık nesne sayfası. Kanıt ve emanet burada; kuyruk yalnız listeler.
 * Kapı `dispute.resolve`: izni olmayan kişide GET /admin/disputes/{id} çıkmaz.
 */
export default async function DisputeDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Uyuşmazlık"
        breadcrumb={objectBreadcrumb("/disputes", id, readQueueState(query))}
        description="Emanetteki parayı işçiye çıkarır veya işverene iade eder; kısmi iade yoktur."
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
  const [entry, evidence, staffRefs] = await Promise.all([
    canReadSummaries
      ? loadSummary(accessToken, dispute.jobAssignmentId)
      : Promise.resolve(undefined),
    loadEvidence(accessToken, dispute.id),
    resolveStaffRefs([dispute.resolvedByStaffId], { accessToken, context }),
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
        staffRefs={staffRefs}
      />
      <StaffNotesSection resourceType="DISPUTE" resourceId={dispute.id} />
      <ObjectTimeline
        resourceId={dispute.id}
        subject="Bu uyuşmazlık"
        events={disputeTimelineEvents(dispute, evidence.ok ? evidence.evidence : [])}
        staffRefs={staffRefs}
      >
        Açılış, kanıtlar ve kayıtlı karar DTO&apos;dan; karar ve emanet hareketleri gibi personel
        işlemleri denetim izinden, bu uyuşmazlık kimliğiyle.
      </ObjectTimeline>
      <ObjectAuditPointer
        resourceId={dispute.id}
        linkLabel="Bu uyuşmazlığın denetim kayıtlarını aç"
      >
        Karar ve emanet hareketleri backend tarafından bu uyuşmazlık kimliğiyle denetim kaydına
        yazılır; personelin bu kaydı açması da kayda düşer.
      </ObjectAuditPointer>
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

/**
 * Uyuşmazlığın DTO'dan türeyen anları (koala-admin#107): açılış, kanıt
 * yüklemeleri ve kayıtlı karar. Çözen personel DTO'da yalnız kimlik; ad
 * çözümü koala-admin#112 ile gelecek, o güne kadar kısa kimlik. Kanıt ucu
 * ayrı düştüyse o satırlar yalnız yoklukla eksilir.
 */
function disputeTimelineEvents(
  dispute: Dispute,
  evidence: readonly DisputeEvidence[],
): readonly TimelineEvent[] {
  const timeline = new TimelineBuilder();
  timeline.push(dispute.createdAt, "Uyuşmazlık açıldı", {
    detail: dispute.openedBySide === null ? null : disputeSideLabel(dispute.openedBySide),
    actor:
      dispute.openedBy === null
        ? null
        : { kind: "user", userId: dispute.openedBy.id, name: safeUserName(dispute.openedBy) },
  });
  for (const file of evidence) {
    timeline.push(file.createdAt, "Kanıt yüklendi", {
      detail: file.fileName,
      actor: { kind: "user", userId: file.uploadedBy.id, name: safeUserName(file.uploadedBy) },
    });
  }
  const resolution =
    dispute.resolution === null ? null : disputeResolutionSpec(dispute.resolution).label;
  const decision = [resolution, dispute.resolutionNote]
    .filter((part): part is string => part !== null)
    .join(" · ");
  timeline.push(dispute.resolvedAt, "Karar verildi", {
    detail: decision.length === 0 ? null : decision,
    actor:
      dispute.resolvedByStaffId === null
        ? null
        : { kind: "staff", staffId: dispute.resolvedByStaffId, name: null },
  });
  return timeline.build();
}
