import Link from "next/link";
import type { Metadata } from "next";

import { RecentOperationsList } from "@/components/escrow/recent-operations-list";
import { PageHeader } from "@/components/panel/page-header";
import {
  FilterId,
  FilterNotice,
  ListSearchForm,
  QueuePager,
  SEARCH_PARAM,
  SearchResultSummary,
  activeSearch,
  searchEmptyTitle,
} from "@/components/panel/queue";
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
} from "@/components/ui";
import { formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import { assignmentHref, disputeHref, disputesHref, userHrefOrNull } from "@/lib/panel-href";
import { DISPUTE_PAGING, getDisputes, type Dispute } from "@/server/api/disputes";
import {
  pageWindow,
  readPaging,
  readParam,
  readUuidParam,
  type PageWindow,
  type SearchParams,
} from "@/server/api/paging";
import { getEscrowSummary } from "@/server/api/escrow";
import { isKoalaApiError } from "@/server/api/errors";
import {
  SEARCH_QUERY_TOO_LONG_MESSAGE,
  isSearchQueryTooLong,
  readSearchQuery,
} from "@/server/api/search-query";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { getStaffContext } from "@/server/authz/staff-context";
import { RequirePermission } from "@/server/authz/require-permission";
import { recentOperations } from "@/server/escrow/recent-operations";

import { DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES, type SummaryEntry } from "./dispute-detail";

export const metadata: Metadata = { title: "Uyuşmazlıklar" };

/**
 * Uyuşmazlık kuyruğu — koala-admin#6.
 *
 * Detay `/disputes/[id]` üzerinde `GET /admin/disputes/{id}`. Emanet tutarları
 * hâlâ atama özetinden (`payment.read`) gelir; DisputeDto tutar taşımaz.
 */

const STATUS_FILTERS = ["ALL", "OPEN", "UNDER_REVIEW", "RESOLVED"] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number];

const FILTER_LABELS: Record<StatusFilter, string> = {
  ALL: "Bekleyenler",
  OPEN: "Açık",
  UNDER_REVIEW: "İncelemede",
  RESOLVED: "Çözüldü",
};

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
            Açık ve çözülmüş uyuşmazlıkları sayfalar. Emanetteki parayı işçiye çıkarır veya işverene
            iade eder; kısmi iade yoktur. Tutarlar atama özetinden gelir.
          </>
        }
      />

      <RequirePermission permission="dispute.resolve">
        <DisputeWorkspace
          filter={readFilter(params.durum)}
          paging={paging}
          query={readSearchQuery(readParam(params, SEARCH_PARAM))}
          userId={readUuidParam(params, "kullanici")}
        />
      </RequirePermission>
    </div>
  );
}

type QueueResult =
  | { ok: true; disputes: Dispute[]; window: PageWindow }
  | { ok: false; searchTooLong: true }
  | {
      ok: false;
      searchTooLong?: false;
      title: string;
      description: string;
      errorCode: string | null;
      requestId: string | null;
    };

async function loadQueue(
  accessToken: string,
  paging: { page: number; size: number },
  filter: StatusFilter,
  query: string | null,
  userId: string | null,
): Promise<QueueResult> {
  try {
    const page = await getDisputes(accessToken, {
      page: paging.page,
      size: paging.size,
      status: filter === "ALL" ? null : filter,
      query,
      userId,
    });
    return {
      ok: true,
      disputes: page.content,
      window: pageWindow(page),
    };
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return { ok: false, searchTooLong: true };
    }
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

/**
 * One escrow read per dispute on the page, in parallel.
 *
 * This is an N+1 and it is deliberate rather than overlooked. `DisputeDto`
 * carries no money at all, so the alternatives were: show no amount in the
 * queue, or compute one in the panel (which it forbids). The page size is
 * bounded to {@link DISPUTE_PAGING} to keep the fan-out small.
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

interface WorkspaceProps {
  filter: StatusFilter;
  paging: { page: number; size: number };
  query: string | null;
  /** `?kullanici=`: işçi, ilan sahibi ya da açan olarak bu kullanıcı (backend `userId`, koala-backend#283). */
  userId: string | null;
}

async function DisputeWorkspace({ filter, paging, query, userId }: WorkspaceProps) {
  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();
  const queue = await loadQueue(accessToken, paging, filter, query, userId);
  const search = activeSearch(query);

  const viewState = {
    ...(filter !== "ALL" ? { durum: filter } : {}),
    boyut: String(paging.size),
    ...(query === null ? {} : { [SEARCH_PARAM]: query }),
    ...(userId === null ? {} : { kullanici: userId }),
  };

  const userNotice =
    userId === null ? null : (
      <FilterNotice
        testId="dispute-user-filter"
        clearHref={disputesHref({
          ...(filter !== "ALL" ? { durum: filter } : {}),
          boyut: String(paging.size),
          ...(query === null ? {} : { [SEARCH_PARAM]: query }),
        })}
      >
        Bu görünüm <FilterId value={userId} /> kullanıcısının işçi, ilan sahibi ya da açan taraf
        olduğu uyuşmazlıkları süzüyor.
      </FilterNotice>
    );

  const searchForm = (error: string | null = null) => (
    <ListSearchForm
      id="uyusmazlik-ara"
      label="Uyuşmazlıklarda ara"
      pathname="/disputes"
      query={query}
      state={viewState}
      placeholder="ör. d1000000, 9a1c0f10 veya ayşe yılmaz"
      hint="Uyuşmazlık kimliği, atama kimliği ve tarafların ad-soyadı ile e-postasında arar; durum süzgeciyle kesişir."
      error={error}
    />
  );

  if (!queue.ok && queue.searchTooLong === true) {
    return <div className="flex flex-col gap-8">{searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}</div>;
  }

  if (!queue.ok) {
    return (
      <div className="flex flex-col gap-8">
        {searchForm()}
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

  const visible = queue.disputes;
  const canReadSummaries = context.has("payment.read");
  const summaries = canReadSummaries
    ? await loadSummaries(accessToken, queue.disputes)
    : new Map<string, SummaryEntry>();

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
            "Uyuşmazlık kaydı tutar taşımaz; emanet rakamları GET /admin/job-assignments/{id} üzerinden payment.read ile okunur. Panel tutar uydurmayacağı için release/refund düğmeleri açılmadı; karar formunda yalnız emanete dokunmayan seçenek kullanılabilir. " +
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
            <code className="font-mono">GET /admin/disputes</code> durum verilmezse bekleyen kuyruğu
            (OPEN ve UNDER_REVIEW) döner. Çözüldü süzgeci kapalı kayıtları sayfalar; DISMISSED bir
            çözüm türüdür, ayrı bir kuyruk durumu değildir. Tutarlar atama özetinden gelir.
          </p>
        </div>

        {userNotice}
        {searchForm()}

        <nav className="flex flex-wrap gap-2" aria-label="Duruma göre süzgeç">
          {STATUS_FILTERS.map((candidate) => (
            <Link
              key={candidate}
              href={{
                pathname: "/disputes",
                query: filterQuery(candidate, queue.window.page, query, userId),
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

        <SearchResultSummary search={search} total={queue.window.totalElements} unit="uyuşmazlık" />

        {visible.length === 0 ? (
          <EmptyState
            title={
              search !== null
                ? searchEmptyTitle(search)
                : filter === "ALL"
                  ? "Bekleyen uyuşmazlık yok."
                  : `${FILTER_LABELS[filter]} durumunda uyuşmazlık yok.`
            }
            description={
              search !== null
                ? "Arama seçili durum süzgeciyle kesişir; başka bir durum seçebilir ya da aramayı temizleyebilirsiniz."
                : filter === "ALL"
                  ? "Emanetteki hiçbir ödeme bir uyuşmazlık tarafından bloke edilmiyor."
                  : "Başka bir durum seçebilir ya da kuyruğu daha sonra yenileyebilirsiniz."
            }
          />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              Bu sayfada {formatInteger(visible.length)} kayıt
              {filter === "ALL" ? "" : ` (${FILTER_LABELS[filter]})`}.
            </p>

            <Table
              caption={filter === "RESOLVED" ? "Çözülmüş uyuşmazlıklar" : "Etkin uyuşmazlıklar"}
            >
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
                  const openedByHref = userHrefOrNull(dispute.openedBy?.id);
                  return (
                    <TableRow key={dispute.id}>
                      <TableCell>
                        <Badge tone={DISPUTE_STATUS_TONES[dispute.status]}>
                          {DISPUTE_STATUS_LABELS[dispute.status]}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {openedByHref === null ? (
                          safeUserName(dispute.openedBy)
                        ) : (
                          <Link href={openedByHref} className="text-brand hover:underline">
                            {safeUserName(dispute.openedBy)}
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        <Link
                          href={assignmentHref(dispute.jobAssignmentId)}
                          className="font-mono text-xs text-brand hover:underline"
                        >
                          {dispute.jobAssignmentId}
                        </Link>
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
                          href={disputeHref(dispute.id)}
                          className="text-sm font-medium text-brand hover:underline"
                        >
                          İncele
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
          <QueuePager window={queue.window} state={viewState} unit="uyuşmazlık" />
        ) : null}
      </section>

      <RecentOperationsList operations={recentOperations()} />
    </div>
  );
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

/** Durum sekmesi aramayı ve kullanıcı süzgecini taşır: ikisi de başka durumda anlamlıdır. */
function filterQuery(
  filter: StatusFilter,
  page = 0,
  search: string | null = null,
  userId: string | null = null,
): Record<string, string> {
  const query: Record<string, string> = {};
  if (filter !== "ALL") query.durum = filter;
  if (page > 0) query.sayfa = String(page);
  if (search !== null) query[SEARCH_PARAM] = search;
  if (userId !== null) query.kullanici = userId;
  return query;
}
