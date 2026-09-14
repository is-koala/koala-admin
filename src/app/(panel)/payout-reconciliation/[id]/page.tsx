import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import type { ReactNode } from "react";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
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
  type BadgeTone,
} from "@/components/ui";
import { EMPTY_VALUE, formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import { assignmentHref, isUuid, jobHref, paymentHref, userHrefOrNull } from "@/lib/panel-href";
import {
  PAYOUT_STATUS_LABELS,
  SETTLEMENT_OPERATION_LABELS,
  SETTLEMENT_TASK_STATUS_LABELS,
  getPayoutDetail,
  payoutPartyName,
  type PayoutDetail,
  type PayoutParty,
  type PayoutStatus,
  type SettlementTaskStatus,
} from "@/server/api/payout-reconciliation";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { submitPayoutReconciliation } from "../actions";

export const metadata: Metadata = { title: "Hakediş" };

const PAYOUT_TONES: Record<PayoutStatus, BadgeTone> = {
  PENDING: "neutral",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

const TASK_TONES: Record<SettlementTaskStatus, BadgeTone> = {
  PENDING: "warning",
  SUCCEEDED: "success",
  FAILED: "danger",
};

/**
 * Hakediş nesne sayfası (koala-admin#95). `GET /admin/payouts/{payoutId}`
 * (`AdminPayoutDetailDto`), `payout.reconcile`. #80'in kanıt alanları —
 * sağlayıcı referansı, alıcı, maskeli IBAN, tutar, para birimi — burada ve
 * PROCESSING hakedişte mevcut mutabakat formunu doldurur; operatör yalnız
 * ekstre referansını ve gerçekleşme anını yazar. Yeni yazma eylemi yok.
 */
export default async function PayoutDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hakediş"
        description={
          <>
            Hakediş, banka mutabakatı kanıtları ve sağlayıcı settlement geçmişi.{" "}
            <Link href={"/payout-reconciliation" as Route} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
      />

      <RequirePermission permission="payout.reconcile">
        <PayoutObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function PayoutObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();

  let payout: PayoutDetail;
  try {
    payout = await getPayoutDetail(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Hakediş detayı"
        permission="payout.reconcile"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const currency = payout.currency ?? "TRY";
  const canOpenAssignment = context.has("payment.read");
  const canOpenJob = context.has("job.read");

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2" aria-labelledby="payout-summary-heading">
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 id="payout-summary-heading" className="text-sm font-semibold">
            Hakediş
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="Hakediş"
              value={<span className="font-mono text-xs break-all">{payout.id}</span>}
            />
            <Row
              label="Durum"
              value={
                <Badge tone={PAYOUT_TONES[payout.status]}>
                  {PAYOUT_STATUS_LABELS[payout.status]}
                </Badge>
              }
            />
            <Row label="Tutar" value={formatCurrency(payout.amount, currency)} />
            <Row label="Para birimi" value={currency} />
            <Row label="Alıcı (işçi)" value={<Party party={payout.worker} />} />
            <Row
              label="İşveren"
              value={
                payout.companyName === null ? (
                  <Party party={payout.employer} />
                ) : (
                  <span>
                    <Party party={payout.employer} /> · {payout.companyName}
                  </span>
                )
              }
            />
            <Row
              label="Maskeli IBAN"
              value={<span className="font-mono text-xs">{payout.maskedIban ?? EMPTY_VALUE}</span>}
            />
            <Row
              label="Atama"
              value={
                canOpenAssignment ? (
                  <Link
                    href={assignmentHref(payout.jobAssignmentId)}
                    className="font-mono text-xs text-brand hover:underline"
                  >
                    {payout.jobAssignmentId}
                  </Link>
                ) : (
                  <span className="font-mono text-xs">{payout.jobAssignmentId}</span>
                )
              }
            />
            <Row
              label="İlan"
              value={
                payout.jobId !== null && canOpenJob ? (
                  <Link href={jobHref(payout.jobId)} className="text-brand hover:underline">
                    {payout.jobTitle ?? payout.jobId}
                  </Link>
                ) : (
                  (payout.jobTitle ?? payout.jobId ?? EMPTY_VALUE)
                )
              }
            />
            {payout.failureReason === null ? null : (
              <Row label="Hata nedeni" value={payout.failureReason} />
            )}
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold">Mutabakat kanıtları</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Sağlayıcı referansı" value={<Mono value={payout.providerReference} />} />
              <Row label="Ekstre referansı" value={<Mono value={payout.settlementReference} />} />
              <Row label="Oluşturulma" value={formatDateTime(payout.createdAt)} />
              <Row label="İşleme alınma" value={formatDateTime(payout.processingAt)} />
              <Row label="Tamamlanma" value={formatDateTime(payout.completedAt)} />
              <Row label="Güncelleme" value={formatDateTime(payout.updatedAt)} />
            </dl>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold">Bağlı ödeme denemeleri</h2>
            {payout.paymentAttempts.length === 0 ? (
              <p className="text-sm text-ink-muted">Bu hakedişe bağlı ödeme denemesi yok.</p>
            ) : (
              <ul className="flex flex-col gap-1 text-sm">
                {payout.paymentAttempts.map((attempt) => (
                  <li key={attempt.id} className="flex flex-wrap items-baseline gap-x-2">
                    {canOpenAssignment ? (
                      <Link
                        href={paymentHref(attempt.id)}
                        className="font-mono text-xs text-brand hover:underline"
                      >
                        {attempt.id}
                      </Link>
                    ) : (
                      <span className="font-mono text-xs">{attempt.id}</span>
                    )}
                    <span className="text-ink-muted">
                      {attempt.status ?? EMPTY_VALUE} · {formatDateTime(attempt.createdAt)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {!canOpenAssignment ? (
              <p className="text-xs text-ink-muted">
                Ödeme ve atama detayı <code className="font-mono">payment.read</code> ister;
                bağlantı verilmedi.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <SettlementHistory payout={payout} currency={currency} />

      <section className="flex flex-col gap-3" aria-labelledby="payout-confirm-heading">
        <h2 id="payout-confirm-heading" className="text-lg font-semibold">
          Ekstre onayı
        </h2>
        {payout.status === "PROCESSING" ? (
          <>
            <p className="max-w-prose text-xs text-ink-muted">
              Hakediş kimliği, sağlayıcı referansı, tutar ve para birimi bu kayıttan dolduruldu.
              Yalnız ekstredeki satır referansını ve gerçekleşme anını yazın.
            </p>
            <PayoutReconciliationForm
              key={payout.id}
              action={submitPayoutReconciliation}
              defaults={{
                payoutId: payout.id,
                ...(payout.providerReference === null
                  ? {}
                  : { providerReference: payout.providerReference }),
                ...(payout.amount === null ? {} : { amount: payout.amount }),
                currency,
              }}
            />
          </>
        ) : (
          <p className="max-w-prose text-sm text-ink-muted" data-testid="payout-not-reconcilable">
            Bu hakediş banka mutabakatı beklemiyor (durum: {PAYOUT_STATUS_LABELS[payout.status]}).
            Backend yalnız PROCESSING hakedişi kabul eder; form bu yüzden çizilmedi.
          </p>
        )}

        <AuditPointer
          permission="payout.reconcile"
          resourceId={payout.id}
          linkLabel="Bu hakedişin mutabakat kayıtlarını aç"
        >
          Başarılı mutabakat denetim kaydına düşer. Panel kanıt alanlarının kayda gövde olarak
          yazıldığını iddia etmez; hata araştırmasında ekrandaki istek kimliği ile loglar
          eşleştirilir.
        </AuditPointer>
      </section>
    </div>
  );
}

function SettlementHistory({ payout, currency }: { payout: PayoutDetail; currency: string }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="payout-settlement-heading">
      <div className="flex flex-col gap-1">
        <h2 id="payout-settlement-heading" className="text-lg font-semibold">
          Settlement geçmişi
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Sağlayıcıya giden onay/iptal/iade işleri ve deneme sayaçları. Banka mutabakatı bunlardan
          ayrı bir adımdır ve yukarıdaki formdan yapılır.
        </p>
      </div>
      {payout.settlementTasks.length === 0 ? (
        <EmptyState
          title="Settlement işi yok."
          description="Sağlayıcıya henüz bir onay ya da iade işi kuyruğa alınmamış."
        />
      ) : (
        <Table caption="Settlement geçmişi">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Zaman</TableHeaderCell>
              <TableHeaderCell>İşlem</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>Deneme</TableHeaderCell>
              <TableHeaderCell>Tutar</TableHeaderCell>
              <TableHeaderCell>Sağlayıcı referansı</TableHeaderCell>
              <TableHeaderCell>Sonraki deneme</TableHeaderCell>
              <TableHeaderCell>Tamamlanma</TableHeaderCell>
              <TableHeaderCell>Son hata</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payout.settlementTasks.map((task) => (
              <TableRow key={task.id}>
                <TableCell>{formatDateTime(task.createdAt)}</TableCell>
                <TableCell>{SETTLEMENT_OPERATION_LABELS[task.operation]}</TableCell>
                <TableCell>
                  <Badge tone={TASK_TONES[task.status]}>
                    {SETTLEMENT_TASK_STATUS_LABELS[task.status]}
                  </Badge>
                </TableCell>
                <TableCell>
                  {task.attempts === null ? EMPTY_VALUE : formatInteger(task.attempts)}
                </TableCell>
                <TableCell>
                  {task.amount === null ? EMPTY_VALUE : formatCurrency(task.amount, currency)}
                </TableCell>
                <TableCell>
                  <Mono value={task.providerTransactionId ?? task.providerReference} />
                </TableCell>
                <TableCell>{formatDateTime(task.nextAttemptAt)}</TableCell>
                <TableCell>{formatDateTime(task.completedAt)}</TableCell>
                <TableCell>
                  <span className="text-xs break-all">{task.lastError ?? EMPTY_VALUE}</span>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Party({ party }: { party: PayoutParty | null }) {
  if (party === null) return <>{EMPTY_VALUE}</>;
  const href = userHrefOrNull(party.id);
  const name = payoutPartyName(party);
  const email = party.email === null || party.email === name ? null : party.email;
  return (
    <span className="flex flex-wrap justify-end gap-x-2">
      {href === null ? (
        <span>{name}</span>
      ) : (
        <Link href={href} className="text-brand hover:underline">
          {name}
        </Link>
      )}
      {email === null ? null : <span className="text-ink-muted">{email}</span>}
    </span>
  );
}

function Mono({ value }: { value: string | null }) {
  if (value === null) return <>{EMPTY_VALUE}</>;
  return <span className="font-mono text-xs break-all">{value}</span>;
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
