import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import {
  CsvExportLink,
  DateRangeFilter,
  FilterId,
  FilterNotice,
  ListSearchForm,
  QueueLoadFailure,
  QueuePager,
  SEARCH_PARAM,
  SearchResultSummary,
  activeSearch,
  searchEmptyTitle,
} from "@/components/panel/queue";
import { PayoutReconciliationForm } from "@/components/payout-reconciliation/payout-reconciliation-form";
import { EmptyState } from "@/components/ui";
import { objectQueryFor } from "@/lib/breadcrumb";
import { hasDateRange } from "@/lib/date-range";
import { isUuid, payoutsHref } from "@/lib/panel-href";
import { toRecordedPayoutEvidence } from "@/lib/payout-reconciliation";
import { getPayouts, type Payout } from "@/server/api/payout-reconciliation";
import { pageWindow, readParam, type SearchParams } from "@/server/api/paging";
import { SEARCH_QUERY_TOO_LONG_MESSAGE, isSearchQueryTooLong } from "@/server/api/search-query";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import {
  payoutFilterState,
  payoutListQuery,
  payoutViewState,
  readPayoutView,
} from "@/server/lists/payouts";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitPayoutReconciliation } from "./actions";
import { PayoutTable } from "./payout-table";

export const metadata: Metadata = { title: "Hakediş banka mutabakatı" };

/**
 * PROCESSING kuyruğu. Liste `GET /admin/payouts` (`payout.reconcile`);
 * status gönderilmez ki backend AWAITING_SETTLEMENT (= PROCESSING) dönsün.
 * Onay mevcut reconcile formundan; satır `?hakedis=` ile formu doldurur.
 * Satırdaki kimlik ve tarih hakediş nesne sayfasına gider
 * (`/payout-reconciliation/{id}`, koala-admin#95); settlement geçmişi orada.
 * #80'de kayıtlı kanıtları elle yeniden yazmak uyuşmazlık üretebildiğinden
 * "Onayla" seçimi kimlik/referans/tutar/para birimini forma kilitli taşır.
 * `?isci=` kuyruğu bir işçiye süzer — backend `workerId` (koala-backend#283);
 * kullanıcı sayfasındaki hakediş sayacı buraya gelir (koala-admin#100).
 * Sayaç her durumu saydığı için o bağlantı `?durum=hepsi` taşır: dört durum
 * birden gönderilir, backend'in PROCESSING varsayılanı devre dışı kalır.
 * O görünümde satırlar PENDING/COMPLETED/FAILED de olabilir; rozet
 * `row.status`tan gelir ve "Onayla" yalnız PROCESSING satırında durur —
 * reconcile ucu başka durumu zaten reddeder (koala-admin#106).
 * `?baslangic=&bitis=` `createdAt` aralığı (koala-admin#110, koala-backend#301);
 * adres okuma `src/server/lists/payouts.ts`'te, CSV rotası aynı okuyucu.
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
            Sağlayıcı işçinin IBAN&apos;ına yatırmayı onayladığında hakediş kendiliğinden kapanır.
            Bu kuyruk yalnız onay anı veya referansı eksik kalan satırlar içindir.
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
  const view = readPayoutView(params);
  const { paging, query, workerId, allStatuses, range } = view;
  const selected = readParam(params, "hakedis");
  const selectedId = selected !== null && isUuid(selected) ? selected : null;
  const search = activeSearch(query);

  const listState = payoutViewState(view);
  const viewState = {
    ...listState,
    ...(selectedId === null ? {} : { hakedis: selectedId }),
  };
  const objectQuery = objectQueryFor(viewState, paging.page);

  const workerNotice =
    workerId === null ? null : (
      <FilterNotice
        testId="payout-worker-filter"
        clearHref={payoutsHref({
          boyut: String(paging.size),
          ...(query === null ? {} : { [SEARCH_PARAM]: query }),
          ...payoutFilterState(view),
        })}
      >
        Bu görünüm işçisi <FilterId value={workerId} /> olan{" "}
        {allStatuses ? "tüm durumlardaki" : "bekleyen"} hakedişleri süzüyor.
      </FilterNotice>
    );

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

  const dateFilter = (
    <DateRangeFilter
      id="hakedis-tarih"
      pathname="/payout-reconciliation"
      range={range}
      state={viewState}
    />
  );

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getPayouts(accessToken, payoutListQuery(view));
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return (
        <div className="flex flex-col gap-6">
          {searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}
          {dateFilter}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {searchForm()}
        {dateFilter}
        <QueueLoadFailure
          subject="Bekleyen hakedişler"
          permission="payout.reconcile"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const rows = page.content;
  const selectedPayout = rows.find((row) => row.id === selectedId) ?? null;

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

        {workerNotice}
        {searchForm()}
        {dateFilter}
        <SearchResultSummary search={search} total={page.totalElements} unit="hakediş" />
        <CsvExportLink list="payouts" state={listState} unit="hakediş" />

        {rows.length === 0 ? (
          <EmptyState
            title={
              search !== null
                ? searchEmptyTitle(search)
                : hasDateRange(range)
                  ? "Bu tarih aralığında hakediş yok."
                  : "Bekleyen hakediş yok."
            }
            description="Mutabakat için bekleyen bir hakediş satırından Onayla'yı seçin."
          />
        ) : (
          <PayoutTable
            rows={rows}
            caption="Bekleyen hakedişler"
            action={{
              selectedId,
              selectionState: {
                ...listState,
                ...(paging.page > 0 ? { sayfa: String(paging.page) } : {}),
              },
            }}
            objectQuery={objectQuery}
          />
        )}

        {page.totalElements > 0 ? (
          <QueuePager window={pageWindow(page)} state={viewState} unit="hakediş" />
        ) : null}
      </section>

      {selectedPayout === null ? null : <ConfirmSection payout={selectedPayout} />}
    </div>
  );
}

function ConfirmSection({ payout }: { payout: Payout }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="payout-confirm-heading">
      <h2 id="payout-confirm-heading" className="text-lg font-semibold">
        Ekstre onayı
      </h2>
      <PayoutReconciliationForm
        key={payout.id}
        action={submitPayoutReconciliation}
        recordedPayout={toRecordedPayoutEvidence(payout)}
      />

      <AuditPointer permission="payout.reconcile" linkLabel="Hakediş mutabakat kayıtlarını aç">
        Başarılı mutabakat denetim kaydına düşer. Panel kanıt alanlarının kayda gövde olarak
        yazıldığını iddia etmez; hata araştırmasında ekrandaki istek kimliği ile loglar
        eşleştirilir.
      </AuditPointer>
    </section>
  );
}
