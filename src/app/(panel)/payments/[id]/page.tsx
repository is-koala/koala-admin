import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
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
import {
  EMPTY_VALUE,
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { assignmentHref, isUuid, jobHref, userHrefOrNull } from "@/lib/panel-href";
import {
  PAYMENT_ATTEMPT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  getPayment,
  paymentCurrency,
  type AdminPayment,
  type RefundStatus,
} from "@/server/api/payments";
import { safeUserName, type SafeUser } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { PAYMENT_ATTEMPT_TONES } from "../../assignments/assignment-detail";

export const metadata: Metadata = { title: "Ödeme denemesi" };

const REFUND_TONES: Record<RefundStatus, "neutral" | "warning" | "success" | "danger"> = {
  PENDING: "neutral",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

/**
 * Tek ödeme denemesi (koala-admin#95). `GET /admin/payments/{paymentId}`,
 * `payment.read`. Kart verisi yoktur — backend DTO'da böyle bir alan yok,
 * panelde de yok. Menüde değil: atama detayındaki tablodan açılır.
 * Yazma eylemi yok; iade atama sayfasındaki mevcut düğmeden yapılır.
 */
export default async function PaymentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Ödeme denemesi"
        description={
          <>
            Tek bir tahsilat denemesi: durum, tutar dökümü, sağlayıcı referansları ve iade
            kayıtları. Kart verisi bu ekranda yoktur.
          </>
        }
      />

      <RequirePermission permission="payment.read">
        <PaymentObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function PaymentObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();

  let payment: AdminPayment;
  try {
    payment = await getPayment(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Ödeme denemesi"
        permission="payment.read"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const currency = paymentCurrency(payment);
  const canOpenJob = context.has("job.read");

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2" aria-labelledby="payment-summary-heading">
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 id="payment-summary-heading" className="text-sm font-semibold">
            Deneme
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="Ödeme"
              value={<span className="font-mono text-xs break-all">{payment.id}</span>}
            />
            <Row
              label="Durum"
              value={
                <Badge tone={PAYMENT_ATTEMPT_TONES[payment.status]}>
                  {PAYMENT_ATTEMPT_STATUS_LABELS[payment.status]}
                </Badge>
              }
            />
            <Row
              label="Atama"
              value={
                <Link
                  href={assignmentHref(payment.jobAssignmentId)}
                  className="font-mono text-xs text-brand hover:underline"
                >
                  {payment.jobAssignmentId}
                </Link>
              }
            />
            <Row
              label="İlan"
              value={
                payment.jobId !== null && canOpenJob ? (
                  <Link href={jobHref(payment.jobId)} className="text-brand hover:underline">
                    {payment.jobTitle ?? payment.jobId}
                  </Link>
                ) : (
                  (payment.jobTitle ?? payment.jobId ?? EMPTY_VALUE)
                )
              }
            />
            <Row label="İşçi" value={<Party user={payment.worker} />} />
            <Row
              label="İşveren"
              value={
                payment.companyName === null ? (
                  <Party user={payment.employer} />
                ) : (
                  <span>
                    <Party user={payment.employer} /> · {payment.companyName}
                  </span>
                )
              }
            />
            <Row label="Başlatılma" value={formatDateTime(payment.createdAt)} />
            <Row label="Tamamlanma" value={formatDateTime(payment.completedAt)} />
            <Row label="Güncelleme" value={formatDateTime(payment.updatedAt)} />
            {payment.failureReason === null ? null : (
              <Row label="Hata nedeni" value={payment.failureReason} />
            )}
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold">Tutar dökümü</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="Tahsil edilen" value={formatCurrency(payment.totalCharged, currency)} />
              <Row label="İşçi payı" value={formatCurrency(payment.workerPayout, currency)} />
              <Row
                label="Komisyon"
                value={
                  payment.commissionRate === null
                    ? formatCurrency(payment.commissionAmount, currency)
                    : `${formatCurrency(payment.commissionAmount, currency)} (${formatPercent(
                        Number(payment.commissionRate),
                      )})`
                }
              />
              <Row label="Para birimi" value={currency} />
              <Row
                label="Fiyat sürümü"
                value={payment.pricingVersion ?? payment.pricing?.pricingVersion ?? EMPTY_VALUE}
              />
            </dl>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold">Sağlayıcı referansları</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <Row label="conversationId" value={<Mono value={payment.conversationId} />} />
              <Row label="providerPaymentId" value={<Mono value={payment.providerPaymentId} />} />
              <Row
                label="providerTransactionId"
                value={<Mono value={payment.providerTransactionId} />}
              />
              <Row
                label="Doğrulama denemesi"
                value={
                  payment.verificationAttempts === null
                    ? EMPTY_VALUE
                    : formatInteger(payment.verificationAttempts)
                }
              />
              <Row label="Sonraki doğrulama" value={formatDateTime(payment.nextVerificationAt)} />
            </dl>
          </div>
        </div>
      </section>

      <Refunds payment={payment} currency={currency} />
    </div>
  );
}

function Refunds({ payment, currency }: { payment: AdminPayment; currency: string }) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="payment-refunds-heading">
      <h2 id="payment-refunds-heading" className="text-lg font-semibold">
        İade kayıtları
      </h2>
      {payment.refunds.length === 0 ? (
        <EmptyState
          title="Bu deneme için iade kaydı yok."
          description="İade, atama sayfasındaki mevcut düğmeden yapılır ve burada listelenir."
        />
      ) : (
        <Table caption="İade kayıtları">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Zaman</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>Tutar</TableHeaderCell>
              <TableHeaderCell>Gerekçe</TableHeaderCell>
              <TableHeaderCell>Sağlayıcı iade no</TableHeaderCell>
              <TableHeaderCell>Tamamlanma</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {payment.refunds.map((refund) => (
              <TableRow key={refund.id}>
                <TableCell>{formatDateTime(refund.createdAt)}</TableCell>
                <TableCell>
                  <Badge tone={REFUND_TONES[refund.status]}>
                    {REFUND_STATUS_LABELS[refund.status]}
                  </Badge>
                </TableCell>
                <TableCell>{formatCurrency(refund.amount, refund.currency ?? currency)}</TableCell>
                <TableCell>{refund.reason ?? EMPTY_VALUE}</TableCell>
                <TableCell>
                  <Mono value={refund.providerRefundId} />
                </TableCell>
                <TableCell>{formatDateTime(refund.completedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function Party({ user }: { user: SafeUser | null }) {
  if (user === null) return <>{EMPTY_VALUE}</>;
  const href = userHrefOrNull(user.id);
  if (href === null) return <>{safeUserName(user)}</>;
  return (
    <Link href={href} className="text-brand hover:underline">
      {safeUserName(user)}
    </Link>
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
