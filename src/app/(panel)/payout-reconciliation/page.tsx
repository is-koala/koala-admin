import Link from "next/link";
import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import {
  ListSearchForm,
  QueueLoadFailure,
  QueuePager,
  SEARCH_PARAM,
  SearchResultSummary,
  activeSearch,
  searchEmptyTitle,
} from "@/components/panel/queue";
import { PayoutReconciliationForm } from "@/components/payout-reconciliation/payout-reconciliation-form";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { assignmentLookupHref, isUuid } from "@/lib/panel-href";
import { getPayouts, PAYOUT_PAGING, type Payout } from "@/server/api/payout-reconciliation";
import { pageWindow, readPaging, readParam, type SearchParams } from "@/server/api/paging";
import {
  SEARCH_QUERY_TOO_LONG_MESSAGE,
  isSearchQueryTooLong,
  readSearchQuery,
} from "@/server/api/search-query";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitPayoutReconciliation } from "./actions";

export const metadata: Metadata = { title: "Hakediş banka mutabakatı" };

/**
 * PROCESSING kuyruğu + UUID yedek. Liste `GET /admin/payouts` (`payout.reconcile`);
 * status gönderilmez ki backend AWAITING_SETTLEMENT (= PROCESSING) dönsün.
 * Onay mevcut reconcile formundan; satır `?hakedis=` ile formu doldurur.
 */
export default async function PayoutReconciliationPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hakediş banka mutabakatı"
        description={
          <>
            Banka ekstresindeki gerçekleşmiş transferi bekleyen bir hakedişle eşleştirin. Kuyruk
            boşsa kimliği forma yazın.
          </>
        }
      />

      <RequirePermission permission="payout.reconcile">
        <PayoutQueue params={params} />
      </RequirePermission>
    </div>
  );
}

async function PayoutQueue({ params }: { params: SearchParams }) {
  const paging = readPaging(params, PAYOUT_PAGING);
  const selected = readParam(params, "hakedis");
  const selectedId = selected !== null && isUuid(selected) ? selected : null;
  const query = readSearchQuery(readParam(params, SEARCH_PARAM));
  const search = activeSearch(query);

  const viewState = {
    boyut: String(paging.size),
    ...(selectedId === null ? {} : { hakedis: selectedId }),
    ...(query === null ? {} : { [SEARCH_PARAM]: query }),
  };

  const searchForm = (error: string | null = null) => (
    <ListSearchForm
      id="hakedis-ara"
      label="Hakedişlerde ara"
      pathname="/payout-reconciliation"
      query={query}
      state={viewState}
      placeholder="ör. 9c000000, ayşe yılmaz veya ayse@example.com"
      hint="Hakediş kimliği, atama kimliği, alıcının ad-soyadı ve e-postasında arar; yalnız bekleyen kuyruk."
      error={error}
    />
  );

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getPayouts(accessToken, { paging, query });
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return (
        <div className="flex flex-col gap-6">
          {searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}
          <ConfirmSection payoutId={selectedId} />
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {searchForm()}
        <QueueLoadFailure
          subject="Bekleyen hakedişler"
          permission="payout.reconcile"
          failure={classifyQueueFailure(error)}
        />
        <ConfirmSection payoutId={selectedId} />
      </div>
    );
  }

  const rows = page.content;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="payout-queue-heading">
        <div className="flex flex-col gap-1">
          <h2 id="payout-queue-heading" className="text-lg font-semibold">
            Bekleyen hakedişler
          </h2>
          <p className="max-w-prose text-xs text-ink-muted">
            GET /admin/payouts status verilmezse yalnız PROCESSING (banka mutabakatı bekleyen)
            döner. Onay mevcut reconcile ucundan yapılır.
          </p>
        </div>

        {searchForm()}
        <SearchResultSummary search={search} total={page.totalElements} unit="hakediş" />

        {rows.length === 0 ? (
          <EmptyState
            title={search === null ? "Bekleyen hakediş yok." : searchEmptyTitle(search)}
            description="Kuyruk boşsa aşağıdaki forma hakediş kimliğini yazabilirsiniz."
          />
        ) : (
          <Table caption="Bekleyen hakedişler">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Tarih</TableHeaderCell>
                <TableHeaderCell>Tutar</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Atama</TableHeaderCell>
                <TableHeaderCell>Onay</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <PayoutRow
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  page={paging.page}
                  query={query}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {page.totalElements > 0 ? (
          <QueuePager window={pageWindow(page)} state={viewState} unit="hakediş" />
        ) : null}
      </section>

      <ConfirmSection payoutId={selectedId} />
    </div>
  );
}

function PayoutRow({
  row,
  selected,
  page,
  query,
}: {
  row: Payout;
  selected: boolean;
  page: number;
  /** Satırdan onaya geçmek aramayı silmesin. */
  query: string | null;
}) {
  return (
    <TableRow>
      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
      <TableCell>{formatCurrency(row.amount, row.currency)}</TableCell>
      <TableCell>
        <Badge tone="warning">İşleniyor</Badge>
      </TableCell>
      <TableCell>
        <Link
          href={assignmentLookupHref(row.jobAssignmentId)}
          className="font-mono text-xs text-brand hover:underline"
        >
          {row.jobAssignmentId}
        </Link>
      </TableCell>
      <TableCell>
        {selected ? (
          <Badge tone="brand">Seçili</Badge>
        ) : (
          <Link
            href={{
              pathname: "/payout-reconciliation",
              query: {
                hakedis: row.id,
                ...(page > 0 ? { sayfa: String(page) } : {}),
                ...(query === null ? {} : { [SEARCH_PARAM]: query }),
              },
            }}
            className="text-sm font-medium text-brand hover:underline"
          >
            Onayla
          </Link>
        )}
      </TableCell>
    </TableRow>
  );
}

function ConfirmSection({ payoutId }: { payoutId: string | null }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="payout-confirm-heading">
      <h2 id="payout-confirm-heading" className="text-lg font-semibold">
        Ekstre onayı
      </h2>
      <PayoutReconciliationForm
        key={payoutId ?? ""}
        action={submitPayoutReconciliation}
        defaults={payoutId === null ? undefined : { payoutId }}
      />

      <AuditPointer permission="payout.reconcile" linkLabel="Hakediş mutabakat kayıtlarını aç">
        Başarılı mutabakat denetim kaydına düşer. Panel kanıt alanlarının kayda gövde olarak
        yazıldığını iddia etmez; hata araştırmasında ekrandaki istek kimliği ile loglar
        eşleştirilir.
      </AuditPointer>
    </section>
  );
}
