import Link from "next/link";

import { SafeUserLink } from "@/components/panel/safe-user-link";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatCurrency, formatDateTime, formatInteger } from "@/lib/format";
import { assignmentHref, paymentHref } from "@/lib/panel-href";
import {
  PAYMENT_ATTEMPT_STATUS_LABELS,
  paymentCurrency,
  type AdminPayment,
} from "@/server/api/payments";

import { PAYMENT_ATTEMPT_TONES } from "../assignments/assignment-detail";

/**
 * Ödeme listesinin tablosu (koala-admin#111). Satır tekil detayla aynı
 * `AdminPaymentDto`; kart verisi ve token DTO'da yok, sütun da yok. Atama
 * bağlantısı `payment.read`'in kendi sayfası — liste zaten o izinle açıldı.
 * Doğrulama sütunu takılı ödemeyi ele verir: `VERIFY_PENDING` iken sonraki
 * doğrulama anı boşsa deneme zamanlayıcıdan düşmüştür (koala-backend#301).
 */
export function PaymentTable({
  rows,
  caption = "Ödeme denemeleri",
  objectQuery = {},
}: {
  rows: readonly AdminPayment[];
  caption?: string;
  /** Satır bağlantısına eklenen liste görünümü; nesne sayfasının kırıntısı geri okur. */
  objectQuery?: Readonly<Record<string, string>>;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Zaman</TableHeaderCell>
          <TableHeaderCell>Durum</TableHeaderCell>
          <TableHeaderCell>İlan</TableHeaderCell>
          <TableHeaderCell>İşveren</TableHeaderCell>
          <TableHeaderCell>İşçi</TableHeaderCell>
          <TableHeaderCell>Tahsil edilen</TableHeaderCell>
          <TableHeaderCell>Doğrulama</TableHeaderCell>
          <TableHeaderCell>Detay</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((payment) => (
          <TableRow key={payment.id}>
            <TableCell>{formatDateTime(payment.createdAt)}</TableCell>
            <TableCell>
              <Badge tone={PAYMENT_ATTEMPT_TONES[payment.status]}>
                {PAYMENT_ATTEMPT_STATUS_LABELS[payment.status]}
              </Badge>
            </TableCell>
            <TableCell>
              <Link
                href={assignmentHref(payment.jobAssignmentId)}
                className="text-brand hover:underline"
              >
                {payment.jobTitle ?? payment.jobAssignmentId}
              </Link>
              {payment.companyName === null ? null : (
                <span className="block text-xs text-ink-muted">{payment.companyName}</span>
              )}
            </TableCell>
            <TableCell>
              <SafeUserLink user={payment.employer} />
            </TableCell>
            <TableCell>
              <SafeUserLink user={payment.worker} />
            </TableCell>
            <TableCell>{formatCurrency(payment.totalCharged, paymentCurrency(payment))}</TableCell>
            <TableCell>
              <VerificationCell payment={payment} />
            </TableCell>
            <TableCell>
              <Link
                href={paymentHref(payment.id, null, objectQuery)}
                className="text-sm font-medium text-brand hover:underline"
              >
                Aç
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function VerificationCell({ payment }: { payment: AdminPayment }) {
  const attempts =
    payment.verificationAttempts === null
      ? null
      : `${formatInteger(payment.verificationAttempts)} deneme`;
  if (payment.status === "VERIFY_PENDING" && payment.nextVerificationAt === null) {
    return (
      <span className="flex flex-col gap-0.5">
        <Badge tone="danger">Takılı</Badge>
        {attempts === null ? null : <span className="text-xs text-ink-muted">{attempts}</span>}
      </span>
    );
  }
  if (payment.nextVerificationAt === null) return <>{attempts ?? EMPTY_VALUE}</>;
  return (
    <span className="flex flex-col gap-0.5">
      <span>Sonraki {formatDateTime(payment.nextVerificationAt)}</span>
      {attempts === null ? null : <span className="text-xs text-ink-muted">{attempts}</span>}
    </span>
  );
}
