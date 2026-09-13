import Link from "next/link";
import type { ReactNode } from "react";

import { userHref } from "@/lib/panel-href";

import {
  EscrowOperationForm,
  type MoneyMovement,
  type ResolutionChoice,
} from "@/components/escrow/escrow-operation-form";
import { Badge, ErrorState, type BadgeTone } from "@/components/ui";
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import {
  DISPUTE_RESOLUTION_SPECS,
  type Dispute,
  type DisputeEvidence,
  type DisputeStatus,
} from "@/server/api/disputes";
import { type EscrowSummary } from "@/server/api/escrow";
import { safeUserName } from "@/server/api/users";
import type { Permission } from "@/server/authz/permissions";
import { submitEscrowOperation } from "@/server/escrow/actions";
import {
  escrowFigure,
  normaliseMoney,
  refundAvailability,
  releaseAvailability,
} from "@/server/escrow/figures";

export const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: "Açık",
  UNDER_REVIEW: "İncelemede",
  RESOLVED: "Çözüldü",
};

export const DISPUTE_STATUS_TONES: Record<DisputeStatus, BadgeTone> = {
  OPEN: "danger",
  UNDER_REVIEW: "warning",
  RESOLVED: "success",
};

const PAYMENT_STATUS_TONES: Record<string, BadgeTone> = {
  HELD_IN_ESCROW: "warning",
  RELEASED_TO_WORKER: "success",
  REFUNDED: "neutral",
  PENDING_COLLECTION: "neutral",
  FAILED: "danger",
};

/** Derived from the same variant contract the Server Action enforces. */
export const RESOLVE_PERMISSION_NOTICE = DISPUTE_RESOLUTION_SPECS.map((spec) => {
  const permissions = [
    "dispute.resolve",
    ...(spec.financialPermission === null ? [] : ["payment.read", spec.financialPermission]),
  ];
  return `${spec.resolution} için ${permissions.join(" ve ")}`;
}).join("; ");

export interface SummaryFailure {
  readonly message: string;
  readonly errorCode: string;
  readonly requestId: string | null;
}

export type SummaryEntry =
  { ok: true; summary: EscrowSummary } | { ok: false; failure: SummaryFailure };

export type EvidenceResult =
  { ok: true; evidence: DisputeEvidence[] } | { ok: false; failure: SummaryFailure };

interface DetailProps {
  dispute: Dispute;
  entry: SummaryEntry | undefined;
  evidence: EvidenceResult | null;
  permissions: readonly Permission[];
}

export function DisputeDetail({ dispute, entry, evidence, permissions }: DetailProps) {
  const summary = entry !== undefined && entry.ok ? entry.summary : null;
  const failure = entry !== undefined && !entry.ok ? entry.failure : null;
  const heldPermissions = new Set(permissions);
  const canRelease = heldPermissions.has("payout.release");
  const canRefund = heldPermissions.has("payment.refund");

  const releaseMovement = summary === null ? null : movementFor(summary, "WORKER");
  const refundMovement = summary === null ? null : movementFor(summary, "EMPLOYER");

  const release = summary === null ? null : releaseAvailability(summary);
  const refund = summary === null ? null : refundAvailability(summary);

  const noSummaryReason =
    failure === null
      ? "Bu atama için emanet özeti okunamadı."
      : `Emanet özeti okunamadı (${failure.errorCode}): ${failure.message}`;

  const choices: ResolutionChoice[] = DISPUTE_RESOLUTION_SPECS.map((spec) => {
    if (spec.beneficiary === null) {
      return {
        resolution: spec.resolution,
        label: spec.label,
        description: spec.description,
        movement: null,
        unavailableReason: null,
      };
    }

    const movement = spec.beneficiary === "WORKER" ? releaseMovement : refundMovement;
    const availability = spec.beneficiary === "WORKER" ? release : refund;
    const permissionDenied =
      spec.financialPermission !== null && !heldPermissions.has(spec.financialPermission);

    return {
      resolution: spec.resolution,
      label: spec.label,
      description: spec.description,
      movement,
      unavailableReason: permissionDenied
        ? `${spec.financialPermission ?? "finans"} izniniz yok; bu finansal karar gönderilemez.`
        : movement === null
          ? noSummaryReason
          : availability !== null && !availability.allowed
            ? availability.reason
            : null,
    };
  });

  return (
    <section className="flex flex-col gap-4" aria-labelledby="dispute-detail-heading">
      <h2 id="dispute-detail-heading" className="text-lg font-semibold">
        Uyuşmazlık detayı
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm">
          <Row label="Uyuşmazlık" value={<span className="font-mono text-xs">{dispute.id}</span>} />
          <Row
            label="Durum"
            value={
              <Badge tone={DISPUTE_STATUS_TONES[dispute.status]}>
                {DISPUTE_STATUS_LABELS[dispute.status]}
              </Badge>
            }
          />
          <Row
            label="Açan taraf"
            value={
              dispute.openedBy === null ? (
                "—"
              ) : (
                <Link href={userHref(dispute.openedBy.id)} className="text-brand hover:underline">
                  {safeUserName(dispute.openedBy)}
                </Link>
              )
            }
          />
          <Row label="Açılış" value={formatDateTime(dispute.createdAt)} />
          <Row
            label="Atama"
            value={
              <Link
                href={{ pathname: "/assignments", query: { atama: dispute.jobAssignmentId } }}
                className="font-mono text-xs text-brand hover:underline"
              >
                {dispute.jobAssignmentId}
              </Link>
            }
          />
          {dispute.status === "RESOLVED" ? (
            <>
              <Row
                label="Kayıtlı çözüm"
                value={
                  dispute.resolution === null
                    ? "—"
                    : (DISPUTE_RESOLUTION_SPECS.find(
                        (spec) => spec.resolution === dispute.resolution,
                      )?.label ?? dispute.resolution)
                }
              />
              <Row label="Karar gerekçesi" value={dispute.resolutionNote ?? "—"} />
              <Row label="Çözüm zamanı" value={formatDateTime(dispute.resolvedAt)} />
            </>
          ) : null}
          {summary === null ? null : (
            <>
              <Row label="İş" value={summary.jobTitle ?? "—"} />
              <Row
                label="İşçi"
                value={
                  <Link href={userHref(summary.worker.id)} className="text-brand hover:underline">
                    {safeUserName(summary.worker)}
                  </Link>
                }
              />
              <Row
                label="İşveren"
                value={
                  <span className="flex flex-wrap justify-end gap-x-2">
                    <Link
                      href={userHref(summary.employer.id)}
                      className="text-brand hover:underline"
                    >
                      {safeUserName(summary.employer)}
                    </Link>
                    {summary.companyName === null ? null : <span>{summary.companyName}</span>}
                  </span>
                }
              />
              <Row label="Atama durumu" value={summary.status} />
              <Row
                label="Ödeme durumu"
                value={
                  <Badge tone={PAYMENT_STATUS_TONES[summary.paymentStatus] ?? "neutral"}>
                    {summary.paymentStatus}
                  </Badge>
                }
              />
            </>
          )}
        </dl>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="text-sm font-semibold">Fiyat dökümü</h3>
            {summary === null ? (
              <p className="text-sm text-ink-muted">{noSummaryReason}</p>
            ) : (
              <dl className="flex flex-col gap-2 text-sm">
                <Row
                  label="İşçiye ödenecek"
                  value={formatCurrency(summary.pricing.workerPayout, summary.pricing.currency)}
                />
                <Row
                  label="Komisyon"
                  value={`${formatCurrency(
                    summary.pricing.serviceFeeAmount,
                    summary.pricing.currency,
                  )} (${formatPercent(Number(summary.pricing.serviceFeeRate))})`}
                />
                <Row
                  label="İşverenden tahsil edilen"
                  value={formatCurrency(summary.pricing.employerTotal, summary.pricing.currency)}
                />
                <Row label="Çalışma süresi" value={`${formatInteger(summary.workHours)} sa`} />
              </dl>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h3 className="text-sm font-semibold">Açılış gerekçesi</h3>
            <p className="text-sm whitespace-pre-wrap text-ink">{dispute.reason}</p>
            {dispute.resolutionNote === null ? null : (
              <p className="text-sm text-ink-muted">Karar notu: {dispute.resolutionNote}</p>
            )}
          </div>

          <EvidencePanel dispute={dispute} evidence={evidence} />
        </div>
      </div>

      <div className="flex flex-col gap-6 rounded-lg border border-border-strong bg-surface p-4">
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">Uyuşmazlığı çöz</h3>
          {dispute.status === "RESOLVED" ? (
            <div className="flex flex-col gap-2">
              <p
                role="status"
                className="rounded-md bg-success-soft px-3 py-2 text-sm text-success"
              >
                Karar kaydedildi
                {dispute.resolution === null
                  ? "."
                  : `: ${
                      DISPUTE_RESOLUTION_SPECS.find(
                        (spec) => spec.resolution === dispute.resolution,
                      )?.label ?? dispute.resolution
                    }.`}
              </p>
              <p className="max-w-prose text-sm text-ink-muted">
                Bu uyuşmazlık kapanmış. Backend ikinci bir çözümü 409 ile reddeder.
              </p>
            </div>
          ) : (
            <>
              <p className="max-w-prose text-xs text-ink-muted">
                <code className="font-mono">POST /admin/disputes/{"{id}"}/resolve</code>. Karar{" "}
                <code className="font-mono">RELEASE_TO_WORKER</code> ise para aynı istekte işçiye
                çıkar, <code className="font-mono">REFUND_EMPLOYER</code> ise işverene iade edilir.
                Kısmi paylaşım yoktur.
              </p>
              <p
                className="max-w-prose rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink"
                data-testid="resolve-permission-notice"
              >
                {RESOLVE_PERMISSION_NOTICE}
              </p>
              <EscrowOperationForm
                action={submitEscrowOperation}
                kind="RESOLVE_DISPUTE"
                assignmentId={dispute.jobAssignmentId}
                disputeId={dispute.id}
                triggerLabel="Kararı gözden geçir"
                title="Uyuşmazlık kararını onayla"
                summary="Karar kaydedilecek ve seçilen yön emanetteki paraya uygulanacak."
                choices={choices}
                notice={RESOLVE_PERMISSION_NOTICE}
              />
            </>
          )}
        </div>

        <div className="grid gap-6 border-t border-border-subtle pt-6 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Emanetten işçiye çıkar</h3>
            <p className="text-xs text-ink-muted">
              <code className="font-mono">POST /admin/job-assignments/{"{id}"}/release</code>. Açık
              uyuşmazlık varken backend bunu reddeder — önce kararı verin.
            </p>
            {canRelease ? (
              <EscrowOperationForm
                action={submitEscrowOperation}
                kind="RELEASE"
                assignmentId={dispute.jobAssignmentId}
                disputeId={dispute.id}
                triggerLabel="Çıkışı gözden geçir"
                title="İşçiye çıkışı onayla"
                summary="Emanetteki tutar işçiye çıkacak."
                movement={releaseMovement}
                disabledReason={
                  releaseMovement === null
                    ? noSummaryReason
                    : release !== null && !release.allowed
                      ? release.reason
                      : null
                }
                notice="Gerekçe release isteğine aynen gönderilir ve kalıcı denetim kaydında saklanır."
              />
            ) : (
              <p className="text-xs text-ink-muted" data-testid="release-permission-missing">
                <code className="font-mono">payout.release</code> izniniz yok; bu işlem
                gösterilmiyor.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">İşverene iade et</h3>
            <p className="text-xs text-ink-muted">
              <code className="font-mono">POST /admin/job-assignments/{"{id}"}/refund</code>. Panel
              istekte tutar göndermez; backend tahsil ettiği tutarın tamamını iade eder.
            </p>
            {canRefund ? (
              <EscrowOperationForm
                action={submitEscrowOperation}
                kind="REFUND"
                assignmentId={dispute.jobAssignmentId}
                disputeId={dispute.id}
                triggerLabel="İadeyi gözden geçir"
                title="İşverene iadeyi onayla"
                summary="Tahsil edilen tutarın tamamı işverene iade edilecek."
                movement={refundMovement}
                tone="danger"
                disabledReason={
                  refundMovement === null
                    ? noSummaryReason
                    : refund !== null && !refund.allowed
                      ? refund.reason
                      : null
                }
              />
            ) : (
              <p className="text-xs text-ink-muted" data-testid="refund-permission-missing">
                <code className="font-mono">payment.refund</code> izniniz yok; bu işlem
                gösterilmiyor.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function EvidencePanel({
  dispute,
  evidence,
}: {
  dispute: Dispute;
  evidence: EvidenceResult | null;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="dispute-evidence-heading"
    >
      <h3 id="dispute-evidence-heading" className="text-sm font-semibold">
        Kanıt dosyaları
      </h3>
      {evidence === null ? (
        <p className="text-sm text-ink-muted">Kanıt dosyaları okunamadı.</p>
      ) : !evidence.ok ? (
        <ErrorState
          title="Kanıt dosyaları yüklenemedi."
          description={`${evidence.failure.message} Uyuşmazlık kuyruğu ve karar kontrolleri kullanılabilir durumda.`}
          errorCode={evidence.failure.errorCode}
          requestId={evidence.failure.requestId}
        />
      ) : evidence.evidence.length === 0 ? (
        <div className="flex flex-col gap-1 text-sm text-ink-muted">
          <p>Bu uyuşmazlığa kanıt dosyası eklenmemiş.</p>
          <p>Kanıt olmadan da karar vermeye devam edebilirsiniz.</p>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {evidence.evidence.map((file) => (
            <li
              key={file.id}
              className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface-sunken p-3 text-sm"
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <span className="font-medium break-all">{file.fileName}</span>
                <a
                  href={disputeEvidenceDownloadPath(dispute.id, file.id)}
                  className="font-medium text-brand hover:underline"
                >
                  İndir
                </a>
              </div>
              <dl className="grid gap-1 text-xs text-ink-muted sm:grid-cols-2">
                <Row label="Tür" value={file.contentType} />
                <Row label="Boyut" value={formatFileSize(file.fileSize)} />
                <Row label="Yükleyen" value={evidenceUploader(file)} />
                <Row label="Yükleme" value={formatDateTime(file.createdAt)} />
              </dl>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

function disputeEvidenceDownloadPath(disputeId: string, evidenceId: string): string {
  return `/api/disputes/${encodeURIComponent(disputeId)}/evidence/${encodeURIComponent(evidenceId)}/download`;
}

function evidenceUploader(file: DisputeEvidence): string {
  const side = file.uploaderSide === "WORKER" ? "İşçi" : "İşveren";
  return `${side} · ${safeUserName(file.uploadedBy)}`;
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${formatInteger(bytes)} B`;
  if (bytes < 1024 * 1024) {
    return `${formatNumber(bytes / 1024, { maximumFractionDigits: 1 })} KB`;
  }
  return `${formatNumber(bytes / (1024 * 1024), { maximumFractionDigits: 1 })} MB`;
}

function movementFor(
  summary: EscrowSummary,
  direction: "WORKER" | "EMPLOYER",
): MoneyMovement | null {
  const figure = escrowFigure(summary, direction);
  if (figure.amount === null) return null;

  return {
    confirmedAmount: normaliseMoney(figure.amount),
    amountText: formatCurrency(figure.amount, figure.currency),
    partyName: figure.partyName,
    partyRole: figure.partyRole,
    source: figure.source,
  };
}
