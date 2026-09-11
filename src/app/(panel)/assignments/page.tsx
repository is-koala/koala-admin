import type { Metadata } from "next";
import type { ReactNode } from "react";

import { QueueLoadFailure } from "@/components/panel/queue";
import { Badge, EmptyState, FormField, TextInput, type BadgeTone } from "@/components/ui";
import {
  EMPTY_VALUE,
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { getEscrowSummary, type EscrowSummary } from "@/server/api/escrow";
import { readParam, type SearchParams } from "@/server/api/paging";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

export const metadata: Metadata = { title: "Atama özeti" };

/**
 * Bağımsız atama bakışı — koala-admin#49.
 *
 * `GET /admin/job-assignments/{id}` `payment.read` ile korunur ve
 * `AdminAssignmentDto` döner. Uyuşmazlık kuyruğu aynı özeti `dispute.resolve`
 * arkasında gösterir; FINANCE_ANALYST o kapıdan geçemez. Liste ucu yok, bakış
 * UUID ile — hakediş mutabakatındaki payout kimliği gibi.
 *
 * Fetch kapının içinde: izni olmayan kişide GET hiç çıkmaz. Taraflar
 * `SafeUserDto`; e-posta fixture'da gelse Zod onu düşürür. Para yazımı
 * (release/refund) burada yok — o uçlar uyuşmazlık kuyruğunda.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const PAYMENT_STATUS_TONES: Record<string, BadgeTone> = {
  HELD_IN_ESCROW: "warning",
  RELEASED_TO_WORKER: "success",
  REFUNDED: "neutral",
  PENDING_COLLECTION: "neutral",
  FAILED: "danger",
};

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Atama özeti</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Tek atamayı kimliğiyle açın. Liste yoktur; kimliği uyuşmazlık kaydından veya ödeme
          runbook&apos;undan alın. <code className="font-mono">payment.read</code> izni gerekir —{" "}
          <code className="font-mono">dispute.resolve</code> bu ekranı açmaz.
        </p>
      </header>

      <RequirePermission permission="payment.read">
        <AssignmentLookup params={params} />
      </RequirePermission>
    </div>
  );
}

async function AssignmentLookup({ params }: { params: SearchParams }) {
  const raw = readParam(params, "atama")?.trim() ?? "";
  const candidate = raw.length === 0 ? null : raw;
  const invalid = candidate !== null && !UUID.test(candidate);

  const form = (
    <LookupForm
      value={candidate ?? ""}
      error={invalid ? "Geçerli bir atama kimliği girin." : null}
    />
  );

  if (candidate === null) {
    return (
      <div className="flex flex-col gap-6">
        {form}
        <EmptyState
          title="Atama kimliği girin."
          description="Bekleyen atamalar listelenmez. Bakış, GET /admin/job-assignments/{id} ile UUID üzerinden yapılır."
        />
      </div>
    );
  }

  if (invalid) {
    return <div className="flex flex-col gap-6">{form}</div>;
  }

  const accessToken = await getKoalaAccessToken();

  let summary: EscrowSummary;
  try {
    summary = await getEscrowSummary(accessToken, candidate);
  } catch (error) {
    return (
      <div className="flex flex-col gap-6">
        {form}
        <QueueLoadFailure
          subject="Atama özeti"
          permission="payment.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {form}
      <AssignmentSummary summary={summary} />
    </div>
  );
}

function LookupForm({ value, error }: { value: string; error: string | null }) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      <FormField
        id="atama"
        label="Atama kimliği"
        required
        error={error}
        className="min-w-0 flex-1"
        hint="UUID. Yanlış biçim backend'e gitmez."
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            name="atama"
            defaultValue={value}
            required
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder="ör. 9a1c0f10-0001-4c00-8000-0000000000aa"
          />
        )}
      </FormField>
      <button
        type="submit"
        className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
      >
        Bak
      </button>
    </form>
  );
}

function AssignmentSummary({ summary }: { summary: EscrowSummary }) {
  const employerLabel =
    summary.companyName === null
      ? safeUserName(summary.employer)
      : `${safeUserName(summary.employer)} · ${summary.companyName}`;

  return (
    <section className="flex flex-col gap-4" aria-labelledby="assignment-summary-heading">
      <h2 id="assignment-summary-heading" className="text-lg font-semibold">
        Atama
      </h2>

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm">
          <Row label="Atama" value={<span className="font-mono text-xs">{summary.id}</span>} />
          <Row label="İş" value={summary.jobTitle ?? EMPTY_VALUE} />
          <Row label="İşçi" value={safeUserName(summary.worker)} />
          <Row label="İşveren" value={employerLabel} />
          <Row label="Atama durumu" value={summary.status} />
          <Row
            label="Ödeme durumu"
            value={
              <Badge tone={PAYMENT_STATUS_TONES[summary.paymentStatus] ?? "neutral"}>
                {summary.paymentStatus}
              </Badge>
            }
          />
          <Row label="Atama zamanı" value={formatDateTime(summary.assignmentDateTime)} />
          <Row label="Tamamlanma" value={formatDateTime(summary.actualCompletionDateTime)} />
        </dl>

        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h3 className="text-sm font-semibold">Fiyat dökümü</h3>
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
        </div>
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
