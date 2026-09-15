import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { EmptyState, FormField, TextInput, Button } from "@/components/ui";
import { financeSummaryQuery, parseFinanceRequest } from "@/lib/finance-summary";
import { formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import { getFinanceSummary, type FinanceSummary } from "@/server/api/finance";
import type { SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

export const metadata: Metadata = { title: "Finans özeti" };

/**
 * Toplu finans bakışı — koala-admin#50.
 *
 * `GET /admin/finance/summary` `finance.read` ister. `payment.read` tekil atama
 * (#49), `dispute.resolve` emanet — DISPUTE_HANDLER burayı açmaz. Fetch kapının
 * içinde: izni olmayan kişide GET hiç çıkmaz. Grafik, CSV, Iyzico mutabakatı
 * yok; backend'in verdiği ondalık metin tutarlar gösterilir.
 */

export default async function FinancePage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;
  const request = parseFinanceRequest(params);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Finans özeti"
        description={
          <>
            Dönemdeki başarılı tahsilat hacmi, Koala hizmet bedeli ve tamamlanan hakedişler.
            Bekleyen hakediş anlık yükümlülüktür, dönem süzgecine girmez.
          </>
        }
      />

      <RequirePermission permission="finance.read">
        <FinanceView request={request} />
      </RequirePermission>
    </div>
  );
}

async function FinanceView({ request }: { request: ReturnType<typeof parseFinanceRequest> }) {
  const form = <PeriodForm filters={request.filters} invalid={request.period.kind === "invalid"} />;

  if (request.period.kind === "invalid") {
    return (
      <div className="flex flex-col gap-6">
        {form}
        <EmptyState title="Dönem geçersiz." description={request.period.message} />
      </div>
    );
  }

  const query = financeSummaryQuery(request);
  /* v8 ignore next 3 -- period.kind !== invalid iken query her zaman dolu. */
  if (query === null) {
    throw new Error("Geçerli dönem için finans sorgusu üretilmedi.");
  }

  let summary: FinanceSummary;
  try {
    summary = await getFinanceSummary(await getKoalaAccessToken(), query);
  } catch (error) {
    return (
      <div className="flex flex-col gap-6">
        {form}
        <QueueLoadFailure
          subject="Finans özeti"
          permission="finance.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {form}
      <FinanceTotals summary={summary} />
    </div>
  );
}

function PeriodForm({
  filters,
  invalid,
}: {
  filters: ReturnType<typeof parseFinanceRequest>["filters"];
  invalid: boolean;
}) {
  return (
    <form
      method="get"
      action="/finance"
      aria-label="Finans dönemi"
      className="flex flex-wrap items-end gap-3"
    >
      <FormField
        id="finance-from"
        label="Başlangıç"
        hint="Gün dahil, Europe/Istanbul 00:00."
        error={
          invalid
            ? "Başlangıç ve bitişi birlikte, bitiş başlangıçtan önce olmayacak şekilde seçin."
            : null
        }
      >
        {({ id, describedBy, invalid: fieldInvalid }) => (
          <TextInput
            id={id}
            name="from"
            type="date"
            defaultValue={filters.fromDay ?? ""}
            aria-invalid={fieldInvalid || undefined}
            aria-describedby={describedBy}
          />
        )}
      </FormField>
      <FormField
        id="finance-to"
        label="Bitiş"
        hint="Gün dahil; ertesi 00:00 hariç Instant olarak gider."
      >
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            name="to"
            type="date"
            defaultValue={filters.toDay ?? ""}
            aria-describedby={describedBy}
          />
        )}
      </FormField>
      <FormField id="finance-currency" label="Para birimi" hint="Boş bırakılırsa TRY.">
        {({ id, describedBy }) => (
          <TextInput
            id={id}
            name="para"
            defaultValue={filters.currency}
            maxLength={3}
            autoComplete="off"
            spellCheck={false}
            aria-describedby={describedBy}
          />
        )}
      </FormField>
      <Button size="sm" type="submit">
        Göster
      </Button>
    </form>
  );
}

function FinanceTotals({ summary }: { summary: FinanceSummary }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="finance-summary-heading">
      <h2 id="finance-summary-heading" className="text-lg font-semibold">
        Dönem toplamları
      </h2>
      <p className="text-sm text-ink-muted">
        {formatDateTime(summary.from)} – {formatDateTime(summary.to)} · {summary.currency}
      </p>

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm">
          <Row
            label="İşveren hacmi"
            value={formatCurrency(summary.employerVolume, summary.currency)}
          />
          <Row
            label="Koala hizmet bedeli"
            value={formatCurrency(summary.koalaFee, summary.currency)}
          />
          <Row
            label="Çalışan hak edişi"
            value={formatCurrency(summary.workerPayout, summary.currency)}
          />
          <Row label="Başarılı ödeme" value={formatInteger(summary.succeededPaymentCount)} />
        </dl>
        <dl className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm">
          <Row
            label="Tamamlanan hakediş"
            value={formatCurrency(summary.completedPayoutAmount, summary.currency)}
          />
          <Row
            label="Tamamlanan hakediş sayısı"
            value={formatInteger(summary.completedPayoutCount)}
          />
          <Row
            label="Bekleyen hakediş"
            value={formatCurrency(summary.awaitingPayoutAmount, summary.currency)}
          />
          <Row label="Bekleyen hakediş sayısı" value={formatInteger(summary.awaitingPayoutCount)} />
        </dl>
      </div>
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
