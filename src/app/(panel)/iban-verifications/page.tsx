import Link from "next/link";
import type { Metadata } from "next";

import { IbanVerificationForm } from "@/components/iban-verification/iban-verification-form";
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
} from "@/components/ui";
import { EMPTY_VALUE, formatCurrency, formatDateTime } from "@/lib/format";
import {
  getPendingIbanVerifications,
  IBAN_PENDING_PAGING,
  ibanPendingAmountText,
  type IbanPending,
} from "@/server/api/iban-verification";
import { pageWindow, readPaging, readParam, type SearchParams } from "@/server/api/paging";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitIbanVerification } from "./actions";

export const metadata: Metadata = { title: "IBAN doğrulama" };

/**
 * IBAN kuyruğu — koala-backend#202.
 *
 * `GET /admin/bank-account-verifications` yalnız PENDING + süresi dolmamış
 * satırları sayfalar. Tam IBAN yoktur. Ret ucu yoktur; onay satırdan
 * `?referans=` / `?tutar=` ile mevcut confirm formuna düşer. Gönderen IBAN
 * hâlâ ekstreden yazılır — kuyruk onu taşımaz.
 */
export default async function IbanVerificationsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="IBAN doğrulama"
        description={
          <>
            Bekleyen küçük havaleleri kuyruktan seçin ve ekstre satırıyla onaylayın. Liste maskeli
            IBAN ve referans taşır; tam IBAN yoktur. Reddetme ucu yok.{" "}
            <code className="font-mono">bank.account.verify</code> izni gerekir.
          </>
        }
      />

      <RequirePermission permission="bank.account.verify">
        <IbanQueue params={params} />
      </RequirePermission>
    </div>
  );
}

async function IbanQueue({ params }: { params: SearchParams }) {
  const paging = readPaging(params, IBAN_PENDING_PAGING);
  const selectedReference = readParam(params, "referans");
  const selectedAmount = readParam(params, "tutar") ?? "";

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getPendingIbanVerifications(accessToken, paging);
  } catch (error) {
    return (
      <QueueLoadFailure
        subject="Bekleyen IBAN doğrulamaları"
        permission="bank.account.verify"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const rows = page.content;
  const prefillFromRow = rows.find((row) => row.reference === selectedReference) ?? null;
  const prefillAmount =
    selectedAmount.length > 0
      ? selectedAmount
      : prefillFromRow === null
        ? ""
        : ibanPendingAmountText(prefillFromRow.amount);

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-3" aria-labelledby="iban-queue-heading">
        <div className="flex flex-col gap-1">
          <h2 id="iban-queue-heading" className="text-lg font-semibold">
            Bekleyen doğrulamalar
          </h2>
          <p className="max-w-prose text-xs text-ink-muted">
            <code className="font-mono">GET /admin/bank-account-verifications</code> yalnız PENDING
            ve süresi dolmamış satırları döner. Onay mevcut confirm ucundan yapılır.
          </p>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="Bekleyen IBAN doğrulaması yok."
            description="Kuyruk boşsa ekstredeki referansı yine de aşağıdaki forma yazabilirsiniz."
          />
        ) : (
          <Table caption="Bekleyen IBAN doğrulamaları">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Kullanıcı</TableHeaderCell>
                <TableHeaderCell>IBAN</TableHeaderCell>
                <TableHeaderCell>Tutar</TableHeaderCell>
                <TableHeaderCell>Referans</TableHeaderCell>
                <TableHeaderCell>Başlangıç</TableHeaderCell>
                <TableHeaderCell>Bitiş</TableHeaderCell>
                <TableHeaderCell>Onay</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <PendingRow
                  key={row.accountId}
                  row={row}
                  selected={row.reference === selectedReference}
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
              ...(selectedReference === null ? {} : { referans: selectedReference }),
              ...(selectedAmount.length === 0 ? {} : { tutar: selectedAmount }),
            }}
            unit="doğrulama"
          />
        ) : null}
      </section>

      <section className="flex flex-col gap-3" aria-labelledby="iban-confirm-heading">
        <h2 id="iban-confirm-heading" className="text-lg font-semibold">
          Ekstre onayı
        </h2>
        <IbanVerificationForm
          key={`${selectedReference ?? ""}-${prefillAmount}`}
          action={submitIbanVerification}
          defaults={{
            ...(selectedReference === null ? {} : { reference: selectedReference }),
            ...(prefillAmount.length === 0 ? {} : { amount: prefillAmount }),
          }}
        />
      </section>

      <AuditPointer permission="bank.account.verify" linkLabel="IBAN doğrulama kayıtlarını aç">
        Backend başarılı işlemi <code className="font-mono">bank.account.verify</code> adıyla
        kaydeder. Panel, ekstre alanlarının request body olarak denetim kaydında tutulduğunu iddia
        etmez; hata araştırmasında ekrandaki requestId ile backend logları eşleştirilir.
      </AuditPointer>
    </div>
  );
}

function PendingRow({
  row,
  selected,
  page,
}: {
  row: IbanPending;
  selected: boolean;
  page: number;
}) {
  const amountText = ibanPendingAmountText(row.amount);

  return (
    <TableRow>
      <TableCell>{safeUserName(row.user)}</TableCell>
      <TableCell>
        <span className="font-mono text-xs">{row.maskedIban}</span>
      </TableCell>
      <TableCell>{row.amount === null ? EMPTY_VALUE : formatCurrency(row.amount)}</TableCell>
      <TableCell>
        <span className="font-mono text-xs">{row.reference}</span>
      </TableCell>
      <TableCell>{formatDateTime(row.startedAt)}</TableCell>
      <TableCell>{formatDateTime(row.expiresAt)}</TableCell>
      <TableCell>
        {selected ? (
          <Badge tone="brand">Seçili</Badge>
        ) : (
          <Link
            href={{
              pathname: "/iban-verifications",
              query: {
                referans: row.reference,
                ...(amountText.length === 0 ? {} : { tutar: amountText }),
                ...(page > 0 ? { sayfa: String(page) } : {}),
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
