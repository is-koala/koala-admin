import Link from "next/link";
import type { Metadata } from "next";

import { PayoutReconciliationForm } from "@/components/payout-reconciliation/payout-reconciliation-form";
import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure, QueuePager } from "@/components/panel/queue";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type BadgeTone,
} from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { pageWindow, readPaging, readParam, type SearchParams } from "@/server/api/paging";
import {
  getAdminPayouts,
  PAYOUT_QUEUE_PAGING,
  type Payout,
  type PayoutStatus,
} from "@/server/api/payout-reconciliation";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitPayoutReconciliation } from "./actions";

export const metadata: Metadata = { title: "Hakediş banka mutabakatı" };

/**
 * Hakediş kuyruğu — koala-backend#210 / #211.
 *
 * `GET /admin/payouts` `payout.reconcile` ile PROCESSING (banka mutabakatı
 * bekleyen) satırları sayfalar. Onay hâlâ `POST .../{id}/reconcile`. UUID
 * formu yedek: kuyruk sağlayıcı referansı ve ekstre satırını taşımaz.
 */

const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  PENDING: "Talimat kuyruğunda",
  PROCESSING: "Mutabakat bekliyor",
  COMPLETED: "Tamamlandı",
  FAILED: "Başarısız",
};

const PAYOUT_STATUS_TONES: Record<PayoutStatus, BadgeTone> = {
  PENDING: "neutral",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

export default async function PayoutReconciliationPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hakediş banka mutabakatı"
        description={
          <>
            Banka kanıtı bekleyen hakedişleri kuyruktan seçin ve ekstre satırıyla eşleştirin. Liste
            tutar ve atamayı taşır; ekstre referansı yoktur.
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
  const paging = readPaging(params, PAYOUT_QUEUE_PAGING);
  const selectedId = readParam(params, "hakedis");

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getAdminPayouts(accessToken, paging);
  } catch (error) {
    return (
      <QueueLoadFailure
        subject="Bekleyen hakedişler"
        permission="payout.reconcile"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const rows = page.content;
  const prefillFromRow = rows.find((row) => row.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="payout-queue-heading">
        <div className="flex flex-col gap-1">
          <h2 id="payout-queue-heading" className="text-lg font-semibold">
            Mutabakat bekleyenler
          </h2>
          <p className="max-w-prose text-xs text-ink-muted">
            Liste yalnız banka kanıtı bekleyen satırları döner. Onay mevcut mutabakat formundan
            yapılır.
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Mutabakat bekleyen hakediş yok."
            description="Kuyruk boşsa ekstredeki hakediş kimliğini yine de aşağıdaki forma yazabilirsiniz."
          />
        ) : (
          <Table caption="Mutabakat bekleyen hakedişler">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Oluşturma</TableHeaderCell>
                <TableHeaderCell>Tutar</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Atama</TableHeaderCell>
                <TableHeaderCell>Mutabakat</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <PendingRow
                  key={row.id}
                  row={row}
                  selected={row.id === selectedId}
                  page={paging.page}
                />
              ))}
            </TableBody>
          </Table>
        )}

        {page.totalElements > 0 ? (
          <QueuePager
            window={pageWindow(page)}
            state={{
              boyut: String(paging.size),
              ...(selectedId === null ? {} : { hakedis: selectedId }),
            }}
            unit="hakediş"
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="payout-confirm-heading">
        <h2 id="payout-confirm-heading" className="text-lg font-semibold">
          Ekstre onayı
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Satır tutarı ve para birimini doldurur. Ekstre satırı, sağlayıcı referansı ve gerçekleşme
          anı kuyrukta yoktur; ekstreden yazılır.
        </p>
        <PayoutReconciliationForm
          key={`${selectedId ?? ""}-${prefillFromRow?.amount ?? ""}-${prefillFromRow?.currency ?? ""}`}
          action={submitPayoutReconciliation}
          defaults={{
            ...(selectedId === null ? {} : { payoutId: selectedId }),
            ...(prefillFromRow === null
              ? {}
              : { amount: prefillFromRow.amount, currency: prefillFromRow.currency }),
          }}
        />
      </section>

      <AuditPointer permission="payout.reconcile" linkLabel="Hakediş mutabakat kayıtlarını aç">
        Backend başarılı işlemi hakediş mutabakatı olarak kaydeder. Panel, bu formdaki kanıt
        alanlarının request body olarak denetim kaydında tutulduğunu iddia etmez; hata
        araştırmasında ekrandaki requestId ile backend logları eşleştirilir.
      </AuditPointer>
    </div>
  );
}

function PendingRow({ row, selected, page }: { row: Payout; selected: boolean; page: number }) {
  return (
    <TableRow>
      <TableCell>{formatDateTime(row.createdAt)}</TableCell>
      <TableCell>{formatCurrency(row.amount, row.currency)}</TableCell>
      <TableCell>
        <Badge tone={PAYOUT_STATUS_TONES[row.status]}>{PAYOUT_STATUS_LABELS[row.status]}</Badge>
      </TableCell>
      <TableCell>
        <Link
          href={{
            pathname: "/assignments",
            query: { atama: row.jobAssignmentId },
          }}
          className="text-sm font-medium text-brand hover:underline"
        >
          Aç
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
              },
            }}
            className="text-sm font-medium text-brand hover:underline"
          >
            Mutabık kıl
          </Link>
        )}
      </TableCell>
    </TableRow>
  );
}
