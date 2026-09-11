import Link from "next/link";
import type { ReactNode } from "react";
import type { Metadata } from "next";

import {
  EscrowOperationForm,
  type MoneyMovement,
  type ResolutionChoice,
} from "@/components/escrow/escrow-operation-form";
import { RecentOperationsList } from "@/components/escrow/recent-operations-list";
import { PageHeader } from "@/components/panel/page-header";
import { QueuePager } from "@/components/panel/queue";
import {
  Badge,
  EmptyState,
  ErrorState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type BadgeTone,
} from "@/components/ui";
import {
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatNumber,
  formatPercent,
} from "@/lib/format";
import {
  ACTIVE_DISPUTE_STATUSES,
  DISPUTE_PAGING,
  DISPUTE_RESOLUTION_SPECS,
  getDisputeEvidence,
  getDisputes,
  type Dispute,
  type DisputeEvidence,
  type DisputeStatus,
} from "@/server/api/disputes";
import { pageWindow, readPaging, type PageWindow, type SearchParams } from "@/server/api/paging";
import { getEscrowSummary, type EscrowSummary } from "@/server/api/escrow";
import { isKoalaApiError } from "@/server/api/errors";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";
import { RequirePermission } from "@/server/authz/require-permission";
import { submitEscrowOperation } from "@/server/escrow/actions";
import {
  escrowFigure,
  normaliseMoney,
  refundAvailability,
  releaseAvailability,
} from "@/server/escrow/figures";
import { recentOperations } from "@/server/escrow/recent-operations";

export const metadata: Metadata = { title: "Uyuşmazlıklar" };

/**
 * The screen koala-admin#6 exists for.
 *
 * Today, in production, a worker's daily wage can sit frozen in escrow
 * indefinitely: the mobile app opens a dispute (`POST /job-assignments/{id}/dispute`),
 * `PayoutManager.releaseToWorker` then refuses every release with
 * `DisputeMessages.BLOCKS_RELEASE`, and the only thing that clears it is
 * `POST /admin/disputes/{disputeId}/resolve` — which no screen has ever called.
 * This page calls it.
 *
 * ## Why one route and not `/disputes/[id]`
 *
 * There is no `GET /admin/disputes/{id}` that returns one dispute record; the
 * evidence sub-resource does not provide dispute details. A detail *route*
 * would have to page through the list to find its own record, so the detail is
 * a panel on this page instead, selected by `?uyusmazlik=`, rendered from the
 * list response the queue already fetched. Deep-linkable, and no invented
 * endpoint.
 *
 * ## Where the money numbers come from
 *
 * Not from here. `DisputeDto` carries no amount and no parties beyond
 * `openedBy`, so every figure on this page is read from
 * `getEscrowSummary(...)` — see `src/server/api/escrow.ts` for what that
 * endpoint is and is not today. When it cannot be read, the page shows the
 * dispute, hides the money, and says why. It never fills a gap with a number it
 * worked out itself.
 */

/**
 * `?durum=` — the queue filter.
 *
 * Only the two statuses the list endpoint can return. `RESOLVED` is absent on
 * purpose: `DisputeManager.getPending` filters on `ACTIVE`, so a "Resolved" tab
 * would be a control that is always empty and always misleading. The
 * `satisfies` below fails the build if the backend's active set ever changes
 * without this list changing with it.
 */
const STATUS_FILTERS = ["ALL", "OPEN", "UNDER_REVIEW"] as const satisfies readonly [
  "ALL",
  ...DisputeStatus[],
];

type StatusFilter = (typeof STATUS_FILTERS)[number];

const _FILTERS_COVER_ACTIVE: Record<(typeof ACTIVE_DISPUTE_STATUSES)[number], StatusFilter> = {
  OPEN: "OPEN",
  UNDER_REVIEW: "UNDER_REVIEW",
};
const FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "Tümü",
  OPEN: "Açık",
  UNDER_REVIEW: "İncelemede",
};

const DISPUTE_STATUS_LABELS: Record<DisputeStatus, string> = {
  OPEN: "Açık",
  UNDER_REVIEW: "İncelemede",
  RESOLVED: "Çözüldü",
};

const DISPUTE_STATUS_TONES: Record<DisputeStatus, BadgeTone> = {
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
const RESOLVE_PERMISSION_NOTICE = DISPUTE_RESOLUTION_SPECS.map((spec) => {
  const permissions = [
    "dispute.resolve",
    ...(spec.financialPermission === null ? [] : ["payment.read", spec.financialPermission]),
  ];
  return `${spec.resolution} için ${permissions.join(" ve ")}`;
}).join("; ");

interface PageProps {
  searchParams: Promise<SearchParams>;
}

export default async function DisputesPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const paging = readPaging(params, DISPUTE_PAGING);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Uyuşmazlıklar ve emanet"
        description={
          <>
            Açık uyuşmazlıkları çözer ve emanetteki parayı işçiye çıkarır ya da işverene iade eder.{" "}
            <code className="font-mono">dispute.resolve</code> izni gerektirir. Para taşıyan her yol
            ayrıca <code className="font-mono">payment.read</code> ile birlikte yönüne göre{" "}
            <code className="font-mono">payout.release</code> ya da{" "}
            <code className="font-mono">payment.refund</code> ister.
          </>
        }
      />

      <RequirePermission permission="dispute.resolve">
        <DisputeWorkspace
          filter={readFilter(params.durum)}
          selectedId={readSingle(params.uyusmazlik)}
          paging={paging}
        />
      </RequirePermission>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

type QueueResult =
  | { ok: true; disputes: Dispute[]; window: PageWindow }
  | {
      ok: false;
      title: string;
      description: string;
      errorCode: string | null;
      requestId: string | null;
    };

async function loadQueue(
  accessToken: string,
  paging: { page: number; size: number },
): Promise<QueueResult> {
  try {
    const page = await getDisputes(accessToken, { page: paging.page, size: paging.size });
    return {
      ok: true,
      disputes: page.content,
      window: pageWindow(page),
    };
  } catch (error) {
    if (isKoalaApiError(error) && error.isForbidden) {
      return {
        ok: false,
        title: "Backend uyuşmazlık kuyruğunu vermedi.",
        description:
          "Panel sayfayı açtı, backend listeyi reddetti. Yetki kararını backend verir; paneldeki kapı yalnız gereksiz istekleri önler. GET /admin/disputes de dispute.resolve iznini ister — ayrı bir okuma izni yoktur.",
        errorCode: error.errorCode,
        requestId: error.requestId,
      };
    }

    return {
      ok: false,
      title: "Uyuşmazlık kuyruğu yüklenemedi.",
      description: isKoalaApiError(error)
        ? error.message
        : error instanceof Error
          ? error.message
          : "Bilinmeyen bir hata oluştu.",
      errorCode: isKoalaApiError(error) ? error.errorCode : null,
      requestId: isKoalaApiError(error) ? error.requestId : null,
    };
  }
}

interface SummaryFailure {
  readonly message: string;
  readonly errorCode: string;
  readonly requestId: string | null;
}

type SummaryEntry = { ok: true; summary: EscrowSummary } | { ok: false; failure: SummaryFailure };

type EvidenceResult =
  { ok: true; evidence: DisputeEvidence[] } | { ok: false; failure: SummaryFailure };

/**
 * One escrow read per dispute on the page, in parallel.
 *
 * This is an N+1 and it is deliberate rather than overlooked. `DisputeDto`
 * carries no money at all, so the alternatives were: show no amount in the
 * queue (which koala-admin#6 asks for by name), or compute one in the panel
 * (which it forbids). The page size is bounded to {@link DISPUTE_PAGING} to
 * keep the fan-out small, and the real fix is on the backend — either the
 * dispute list carries the assignment's escrow figures, or there is a bulk
 * read. Until then this is the honest shape.
 *
 * `allSettled`, never `all`: one assignment the backend will not talk about
 * must not blank the whole queue.
 */
async function loadSummaries(
  accessToken: string,
  disputes: readonly Dispute[],
): Promise<Map<string, SummaryEntry>> {
  const results = await Promise.allSettled(
    disputes.map((dispute) => getEscrowSummary(accessToken, dispute.jobAssignmentId)),
  );

  const byAssignment = new Map<string, SummaryEntry>();

  results.forEach((result, index) => {
    const dispute = disputes[index];
    if (dispute === undefined) return;

    if (result.status === "fulfilled") {
      byAssignment.set(dispute.jobAssignmentId, { ok: true, summary: result.value });
      return;
    }

    const error: unknown = result.reason;
    byAssignment.set(dispute.jobAssignmentId, {
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
    });
  });

  return byAssignment;
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

/* -------------------------------------------------------------------------- */
/* The workspace                                                               */
/* -------------------------------------------------------------------------- */

interface WorkspaceProps {
  filter: StatusFilter;
  selectedId: string | null;
  paging: { page: number; size: number };
}

async function DisputeWorkspace({ filter, selectedId, paging }: WorkspaceProps) {
  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();
  const queue = await loadQueue(accessToken, paging);

  if (!queue.ok) {
    return (
      <div className="flex flex-col gap-8">
        <ErrorState
          title={queue.title}
          description={queue.description}
          errorCode={queue.errorCode}
          requestId={queue.requestId}
        />
        <RecentOperationsList operations={recentOperations()} />
      </div>
    );
  }

  const visible =
    filter === "ALL" ? queue.disputes : queue.disputes.filter((d) => d.status === filter);
  const selected = queue.disputes.find((dispute) => dispute.id === selectedId) ?? null;
  const canReadSummaries = context.has("payment.read");
  const [summaries, evidence] = await Promise.all([
    canReadSummaries
      ? loadSummaries(accessToken, queue.disputes)
      : Promise.resolve(new Map<string, SummaryEntry>()),
    selected === null ? Promise.resolve(null) : loadEvidence(accessToken, selected.id),
  ]);

  const everySummaryFailed =
    canReadSummaries &&
    queue.disputes.length > 0 &&
    [...summaries.values()].every((entry) => !entry.ok);

  return (
    <div className="flex flex-col gap-8">
      {!canReadSummaries && queue.disputes.length > 0 ? (
        <ErrorState
          title="Emanet tutarlarını görüntüleme izniniz yok."
          description="Atama özeti GET /admin/job-assignments/{id} üzerinde payment.read izni ister. Panel yetkisiz bir özet isteği göndermedi; finansal kararlar kapalı, emanete dokunmayan DISMISSED kararı kullanılabilir."
          errorCode="PANEL_PERMISSION_DENIED"
        />
      ) : everySummaryFailed ? (
        <ErrorState
          title="Emanet tutarları okunamıyor, bu yüzden para işlemleri kapalı."
          description={
            "Uyuşmazlık kaydı tutar taşımıyor (DisputeDto'da tutar alanı yoktur), tutarlar ayrı bir okumadan gelir ve backend bu okumayı şu an vermiyor. Panel tutar uydurmayacağı için release/refund düğmeleri açılmadı; karar formunda yalnız emanete dokunmayan seçenek kullanılabilir. " +
            (summaryFailureDetail(summaries) ?? "")
          }
          errorCode="ESCROW_SUMMARY_UNAVAILABLE"
        />
      ) : null}

      <section className="flex flex-col gap-3" aria-labelledby="dispute-queue-heading">
        <div className="flex flex-col gap-1">
          <h2 id="dispute-queue-heading" className="text-lg font-semibold">
            Kuyruk
          </h2>
          <p className="max-w-prose text-xs text-ink-muted">
            <code className="font-mono">GET /admin/disputes</code> yalnız <em>etkin</em>{" "}
            uyuşmazlıkları döner (OPEN ve UNDER_REVIEW); ucun bir durum parametresi yoktur ve
            çözülmüş bir uyuşmazlık bu uçtan hiç gelmez. Aşağıdaki süzgeç bu yüzden yüklenen
            sayfanın üstünde çalışır, sunucuda değil.
          </p>
        </div>

        <nav className="flex flex-wrap gap-2" aria-label="Duruma göre süzgeç">
          {STATUS_FILTERS.map((candidate) => (
            <Link
              key={candidate}
              href={{
                pathname: "/disputes",
                query: filterQuery(candidate, selectedId, queue.window.page),
              }}
              aria-current={candidate === filter ? "page" : undefined}
              className={
                candidate === filter
                  ? "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white"
                  : "rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
              }
            >
              {FILTER_LABELS[candidate]}
            </Link>
          ))}
        </nav>

        {visible.length === 0 ? (
          <EmptyState
            title={
              queue.disputes.length === 0
                ? "Açık uyuşmazlık yok."
                : "Bu süzgeçle eşleşen uyuşmazlık yok."
            }
            description={
              queue.disputes.length === 0
                ? "Emanetteki hiçbir ödeme bir uyuşmazlık tarafından bloke edilmiyor."
                : `Yüklenen ${formatInteger(queue.disputes.length)} kayıt arasında ${FILTER_LABELS[filter]} durumunda olan yok.`
            }
          />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Bu sayfada {formatInteger(visible.length)} kayıt
              {filter === "ALL"
                ? ""
                : ` (${FILTER_LABELS[filter]} süzgeci, yüklenen ${formatInteger(queue.disputes.length)} satırın üstünde)`}
              .
            </p>

            <Table caption="Etkin uyuşmazlıklar">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Durum</TableHeaderCell>
                  <TableHeaderCell>Açan taraf</TableHeaderCell>
                  <TableHeaderCell>Atama</TableHeaderCell>
                  <TableHeaderCell>Emanetteki tutar</TableHeaderCell>
                  <TableHeaderCell>Açılış</TableHeaderCell>
                  <TableHeaderCell>Detay</TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {visible.map((dispute) => {
                  const entry = summaries.get(dispute.jobAssignmentId);
                  return (
                    <TableRow key={dispute.id}>
                      <TableCell>
                        <Badge tone={DISPUTE_STATUS_TONES[dispute.status]}>
                          {DISPUTE_STATUS_LABELS[dispute.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>{safeUserName(dispute.openedBy)}</TableCell>
                      <TableCell>
                        <span className="font-mono text-xs">{dispute.jobAssignmentId}</span>
                      </TableCell>
                      <TableCell>
                        {entry !== undefined && entry.ok
                          ? formatCurrency(
                              entry.summary.pricing.employerTotal,
                              entry.summary.pricing.currency,
                            )
                          : "—"}
                      </TableCell>
                      <TableCell>{formatDateTime(dispute.createdAt)}</TableCell>
                      <TableCell>
                        <Link
                          href={{
                            pathname: "/disputes",
                            query: {
                              ...filterQuery(filter, null, queue.window.page),
                              uyusmazlik: dispute.id,
                            },
                          }}
                          className="text-sm font-medium text-brand hover:underline"
                        >
                          Aç
                        </Link>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}

        {queue.window.totalElements > 0 ? (
          <QueuePager
            window={queue.window}
            state={{
              ...(filter !== "ALL" ? { durum: filter } : {}),
              ...(selectedId !== null ? { uyusmazlik: selectedId } : {}),
              boyut: String(paging.size),
            }}
            unit="uyuşmazlık"
          />
        ) : null}
      </section>

      {selected === null ? null : (
        <DisputeDetail
          dispute={selected}
          entry={summaries.get(selected.jobAssignmentId)}
          evidence={evidence}
          permissions={context.staff?.permissions ?? []}
        />
      )}

      <RecentOperationsList operations={recentOperations()} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Detail                                                                      */
/* -------------------------------------------------------------------------- */

interface DetailProps {
  dispute: Dispute;
  entry: SummaryEntry | undefined;
  evidence: EvidenceResult | null;
  permissions: readonly Permission[];
}

function DisputeDetail({ dispute, entry, evidence, permissions }: DetailProps) {
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
          <Row label="Açan taraf" value={safeUserName(dispute.openedBy)} />
          <Row label="Açılış" value={formatDateTime(dispute.createdAt)} />
          <Row
            label="Atama"
            value={<span className="font-mono text-xs">{dispute.jobAssignmentId}</span>}
          />
          {summary === null ? null : (
            <>
              <Row label="İş" value={summary.jobTitle ?? "—"} />
              <Row label="İşçi" value={safeUserName(summary.worker)} />
              <Row
                label="İşveren"
                value={
                  summary.companyName === null
                    ? safeUserName(summary.employer)
                    : `${safeUserName(summary.employer)} · ${summary.companyName}`
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
          <p className="max-w-prose text-xs text-ink-muted">
            <code className="font-mono">POST /admin/disputes/{"{id}"}/resolve</code>. Karar{" "}
            <code className="font-mono">RELEASE_TO_WORKER</code> ise para aynı istekte işçiye çıkar,{" "}
            <code className="font-mono">REFUND_EMPLOYER</code> ise işverene iade edilir. Kısmi
            paylaşım yoktur.
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

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Turn a server-read figure into what the confirmation dialog renders.
 *
 * The single place `formatCurrency` is applied to a money movement, and the
 * single place `confirmedAmount` is produced. `normaliseMoney` is not
 * arithmetic — it drops trailing zeros so the round trip compares as text.
 */
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

function summaryFailureDetail(summaries: Map<string, SummaryEntry>): string | null {
  for (const entry of summaries.values()) {
    if (!entry.ok) {
      return `Backend'in cevabı: ${entry.failure.message}`;
    }
  }
  return null;
}

function readSingle(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value === undefined || value.length === 0 ? null : value;
}

function readFilter(value: string | string[] | undefined): StatusFilter {
  const candidate = readSingle(value);
  return STATUS_FILTERS.find((entry) => entry === candidate) ?? "ALL";
}

function filterQuery(
  filter: StatusFilter,
  selectedId: string | null,
  page = 0,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter !== "ALL") query.durum = filter;
  if (selectedId !== null) query.uyusmazlik = selectedId;
  if (page > 0) query.sayfa = String(page);
  return query;
}
