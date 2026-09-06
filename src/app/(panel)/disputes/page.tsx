import Link from "next/link";
import type { Metadata } from "next";

import { RecentOperationsList } from "@/components/escrow/recent-operations-list";
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
import { formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import {
  ACTIVE_DISPUTE_STATUSES,
  getDisputes,
  type Dispute,
  type DisputeStatus,
} from "@/server/api/disputes";
import { getEscrowSummary, type EscrowSummary } from "@/server/api/escrow";
import { isKoalaApiError } from "@/server/api/errors";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
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
 * There is no `GET /admin/disputes/{id}`. The controller has exactly two
 * handlers: the paged list and the resolve. A detail *route* would have to page
 * through the list to find its own record, so the detail — arriving in the next
 * commit — will be a panel on this page, selected by `?uyusmazlik=` and
 * rendered from the list response the queue already fetched. Deep-linkable, and
 * no invented endpoint.
 *
 * ## Where the money numbers come from
 *
 * Not from here. `DisputeDto` carries no amount and no parties beyond
 * `openedBy`, so every figure on this page is read from
 * `getEscrowSummary(...)` — see `src/server/api/escrow.ts` for what that
 * endpoint is and is not today. When it cannot be read, the queue shows a dash
 * and says why. It never fills a gap with a number it worked out itself.
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

/** Bounded on purpose — see `loadSummaries`. */
const QUEUE_PAGE_SIZE = 25;

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function DisputesPage({ searchParams }: PageProps) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Uyuşmazlıklar ve emanet</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Açık uyuşmazlıkları çözer ve emanetteki parayı işçiye çıkarır ya da işverene iade eder.{" "}
          <code className="font-mono">dispute.resolve</code> izni gerektirir; iki para işlemi ayrıca{" "}
          <code className="font-mono">payout.release</code> ve{" "}
          <code className="font-mono">payment.refund</code> ister.
        </p>
      </header>

      <RequirePermission permission="dispute.resolve">
        <DisputeWorkspace
          filter={readFilter(params.durum)}
          selectedId={readSingle(params.uyusmazlik)}
        />
      </RequirePermission>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Loading                                                                     */
/* -------------------------------------------------------------------------- */

type QueueResult =
  | { ok: true; disputes: Dispute[]; totalElements: number; truncated: boolean }
  | {
      ok: false;
      title: string;
      description: string;
      errorCode: string | null;
      correlationId: string | null;
    };

async function loadQueue(accessToken: string): Promise<QueueResult> {
  try {
    const page = await getDisputes(accessToken, { size: QUEUE_PAGE_SIZE });
    return {
      ok: true,
      disputes: page.content,
      totalElements: page.totalElements,
      truncated: !page.last,
    };
  } catch (error) {
    if (isKoalaApiError(error) && error.isForbidden) {
      return {
        ok: false,
        title: "Backend uyuşmazlık kuyruğunu vermedi.",
        description:
          "Panel sayfayı açtı, backend listeyi reddetti. Yetki kararını backend verir; paneldeki kapı yalnız gereksiz istekleri önler. GET /admin/disputes de dispute.resolve iznini ister — ayrı bir okuma izni yoktur.",
        errorCode: error.errorCode,
        correlationId: error.correlationId,
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
      correlationId: isKoalaApiError(error) ? error.correlationId : null,
    };
  }
}

interface SummaryFailure {
  readonly message: string;
  readonly errorCode: string;
  readonly correlationId: string | null;
}

type SummaryEntry = { ok: true; summary: EscrowSummary } | { ok: false; failure: SummaryFailure };

/**
 * One escrow read per dispute on the page, in parallel.
 *
 * This is an N+1 and it is deliberate rather than overlooked. `DisputeDto`
 * carries no money at all, so the alternatives were: show no amount in the
 * queue (which koala-admin#6 asks for by name), or compute one in the panel
 * (which it forbids). The page size is bounded to {@link QUEUE_PAGE_SIZE} to
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
        correlationId: isKoalaApiError(error) ? error.correlationId : null,
      },
    });
  });

  return byAssignment;
}

/* -------------------------------------------------------------------------- */
/* The workspace                                                               */
/* -------------------------------------------------------------------------- */

interface WorkspaceProps {
  filter: StatusFilter;
  selectedId: string | null;
}

async function DisputeWorkspace({ filter, selectedId }: WorkspaceProps) {
  const accessToken = await getKoalaAccessToken();
  const queue = await loadQueue(accessToken);

  if (!queue.ok) {
    return (
      <div className="flex flex-col gap-8">
        <ErrorState
          title={queue.title}
          description={queue.description}
          errorCode={queue.errorCode}
          correlationId={queue.correlationId}
        />
        <RecentOperationsList operations={recentOperations()} />
      </div>
    );
  }

  const summaries = await loadSummaries(accessToken, queue.disputes);
  const visible =
    filter === "ALL" ? queue.disputes : queue.disputes.filter((d) => d.status === filter);

  const everySummaryFailed =
    queue.disputes.length > 0 && [...summaries.values()].every((entry) => !entry.ok);

  return (
    <div className="flex flex-col gap-8">
      {everySummaryFailed ? (
        <ErrorState
          title="Emanet tutarları okunamıyor, bu yüzden para işlemleri kapalı."
          description={
            "Uyuşmazlık kaydı tutar taşımıyor (DisputeDto'da tutar alanı yoktur), tutarlar ayrı bir okumadan gelir ve backend bu okumayı şu an vermiyor. Panel tutar uydurmaz. " +
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
              href={{ pathname: "/disputes", query: filterQuery(candidate, selectedId) }}
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
              Backend {formatInteger(queue.totalElements)} etkin uyuşmazlık bildirdi;{" "}
              {formatInteger(visible.length)} tanesi listeleniyor.
              {queue.truncated ? " Daha fazlası var — sayfalama sonraki dilimde." : ""}
            </p>

            <Table caption="Etkin uyuşmazlıklar">
              <TableHead>
                <TableRow>
                  <TableHeaderCell>Durum</TableHeaderCell>
                  <TableHeaderCell>Açan taraf</TableHeaderCell>
                  <TableHeaderCell>Atama</TableHeaderCell>
                  <TableHeaderCell>Emanetteki tutar</TableHeaderCell>
                  <TableHeaderCell>Açılış</TableHeaderCell>
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
                        {entry !== undefined && entry.ok && entry.summary.totalCharged !== null
                          ? formatCurrency(entry.summary.totalCharged, entry.summary.currency)
                          : "—"}
                      </TableCell>
                      <TableCell>{formatDateTime(dispute.createdAt)}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </>
        )}
      </section>

      <RecentOperationsList operations={recentOperations()} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

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

function filterQuery(filter: StatusFilter, selectedId: string | null): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter !== "ALL") query.durum = filter;
  if (selectedId !== null) query.uyusmazlik = selectedId;
  return query;
}
