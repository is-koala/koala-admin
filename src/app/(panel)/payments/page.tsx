import type { Metadata } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
import { EmptyState } from "@/components/ui";
import { objectQueryFor } from "@/lib/breadcrumb";
import { formatInteger } from "@/lib/format";
import { ALL_STATUSES_PARAM } from "@/lib/panel-href";
import {
  pageWindow,
  readEnumParam,
  readPaging,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import {
  PAYMENT_ATTEMPT_STATUSES,
  PAYMENT_ATTEMPT_STATUS_LABELS,
  PAYMENT_PAGING,
  getPayments,
  type PaymentAttemptStatus,
} from "@/server/api/payments";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { PaymentTable } from "./payment-table";

export const metadata: Metadata = { title: "Ödemeler" };

/**
 * Ödeme denemeleri listesi (koala-admin#111) — `GET /admin/payments?status=`
 * (koala-backend#301), `payment.read`. Kapı listeyi sarar: izin yoksa GET
 * hiç çıkmaz. `?durum=` tek durum ya da `hepsi` (backend'e `status`
 * gönderilmez, her durum); ev karosu takılı ödemeleri `durum=VERIFY_PENDING`
 * ile açar. Sıralama backend'in `createdAt|updatedAt|status|nextVerificationAt`
 * allowlist'i; arama ucu yok, o yüzden arama kutusu da yok.
 */
export default async function PaymentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ödemeler"
        description={
          <>
            Tahsilat denemeleri, durumla süzülür. Kart verisi ve ödeme token&apos;ı bu ekranda
            yoktur; iade atama sayfasından yapılır.
          </>
        }
      />

      <RequirePermission permission="payment.read">
        <PaymentQueue params={params} />
      </RequirePermission>
    </div>
  );
}

const STATUS_PARAM = "durum";

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "updatedAt,desc", label: "Son güncellenen önce" },
  { value: "nextVerificationAt,asc", label: "Sonraki doğrulama önce" },
  { value: "status,asc", label: "Duruma göre (A-Z)" },
];

async function PaymentQueue({ params }: { params: SearchParams }) {
  // `hepsi` varsayılan: backend `status`sız her durumu döner; bilinmeyen değer de oraya düşer.
  const selected = readEnumParam<PaymentAttemptStatus | typeof ALL_STATUSES_PARAM>(
    params,
    STATUS_PARAM,
    [ALL_STATUSES_PARAM, ...PAYMENT_ATTEMPT_STATUSES],
    ALL_STATUSES_PARAM,
  );
  const status: PaymentAttemptStatus | null = selected === ALL_STATUSES_PARAM ? null : selected;
  const paging = readPaging(params, PAYMENT_PAGING);

  const viewState: Record<string, string> = {
    [STATUS_PARAM]: status ?? ALL_STATUSES_PARAM,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };
  const objectQuery = objectQueryFor(viewState, paging.page);

  const filters = (
    <QueueFilters
      filters={[
        {
          name: STATUS_PARAM,
          label: "Durum",
          value: status ?? ALL_STATUSES_PARAM,
          options: [
            { value: ALL_STATUSES_PARAM, label: "Tümü" },
            ...PAYMENT_ATTEMPT_STATUSES.map((value) => ({
              value,
              label: PAYMENT_ATTEMPT_STATUS_LABELS[value],
            })),
          ],
        },
        { name: "sirala", label: "Sıralama", value: sortParam(paging.sort), options: SORT_OPTIONS },
      ]}
      carry={{ boyut: String(paging.size) }}
      notice="Durum ve sıralama listeyi backend'de süzer; ad ya da kimlikle arama ucu yok. Takılı ödeme: doğrulama bekleyen ve sonraki doğrulama anı boş olan deneme."
    />
  );

  let page;
  try {
    page = await getPayments(await getKoalaAccessToken(), { status, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <QueueLoadFailure
          subject="Ödeme listesi"
          permission="payment.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {filters}
      <p className="text-xs text-ink-muted" data-testid="payment-total">
        {page.totalElements === 0
          ? "Kayıt yok."
          : `Toplam ${formatInteger(page.totalElements)} ödeme denemesi.`}
      </p>

      {page.content.length === 0 ? (
        <EmptyState
          title={
            status === null
              ? "Ödeme denemesi yok."
              : `"${PAYMENT_ATTEMPT_STATUS_LABELS[status]}" durumunda ödeme denemesi yok.`
          }
          description="Başka durumdaki denemeler için yukarıdaki süzgeci değiştirin."
        />
      ) : (
        <>
          <PaymentTable rows={page.content} objectQuery={objectQuery} />
          <QueuePager window={pageWindow(page)} state={viewState} unit="ödeme denemesi" />
        </>
      )}
    </div>
  );
}
