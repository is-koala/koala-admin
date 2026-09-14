import Link from "next/link";

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatCurrency, formatDateTime } from "@/lib/format";
import { assignmentHref } from "@/lib/panel-href";
import type { EscrowSummary } from "@/server/api/escrow";
import { safeUserName } from "@/server/api/users";

import { ASSIGNMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from "./labels";

/**
 * Atama kuyruğunun tablosu; kuyruk sayfası ve kullanıcı sayfasının "Atamalar"
 * sekmesi (koala-admin#103) aynı satırı çizer. Süzme ve sayfalama burada
 * değil: gelen sayfa olduğu gibi çizilir.
 */
export function AssignmentTable({
  rows,
  caption = "Atamalar",
}: {
  rows: readonly EscrowSummary[];
  caption?: string;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Atama zamanı</TableHeaderCell>
          <TableHeaderCell>İş</TableHeaderCell>
          <TableHeaderCell>İşçi</TableHeaderCell>
          <TableHeaderCell>İşveren</TableHeaderCell>
          <TableHeaderCell>Durum</TableHeaderCell>
          <TableHeaderCell>Ödeme</TableHeaderCell>
          <TableHeaderCell>Tutar</TableHeaderCell>
          <TableHeaderCell>Detay</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>{formatDateTime(row.assignmentDateTime)}</TableCell>
            <TableCell>{row.jobTitle ?? EMPTY_VALUE}</TableCell>
            <TableCell>{safeUserName(row.worker)}</TableCell>
            <TableCell>
              {row.companyName === null
                ? safeUserName(row.employer)
                : `${safeUserName(row.employer)} · ${row.companyName}`}
            </TableCell>
            <TableCell>
              <Badge>{ASSIGNMENT_STATUS_LABELS[row.status]}</Badge>
            </TableCell>
            <TableCell>
              <Badge tone={PAYMENT_STATUS_TONES[row.paymentStatus]}>
                {PAYMENT_STATUS_LABELS[row.paymentStatus]}
              </Badge>
            </TableCell>
            <TableCell>{formatCurrency(row.pricing.employerTotal, row.pricing.currency)}</TableCell>
            <TableCell>
              <Link
                href={assignmentHref(row.id)}
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
