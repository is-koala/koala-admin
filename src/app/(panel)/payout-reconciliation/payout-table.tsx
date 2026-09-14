import Link from "next/link";

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type BadgeTone,
} from "@/components/ui";
import { formatCurrency, formatDateTime } from "@/lib/format";
import { assignmentHref, payoutHref } from "@/lib/panel-href";
import {
  PAYOUT_STATUS_LABELS,
  type Payout,
  type PayoutStatus,
} from "@/server/api/payout-reconciliation";

const PAYOUT_TONES: Record<PayoutStatus, BadgeTone> = {
  PENDING: "neutral",
  PROCESSING: "warning",
  COMPLETED: "success",
  FAILED: "danger",
};

/**
 * Salt okunur hakediş tablosu — kullanıcı sayfasının "Hakedişler" sekmesi
 * (koala-admin#103). Mutabakat kuyruğunun kendi satırı (`page.tsx`) "Onayla"
 * bağlantısı taşır ve #106 ile ayrıca ele alınıyor; bu tablo o satıra
 * dokunmaz, rozeti DTO'nun `status` alanından çizer.
 */
export function PayoutTable({
  rows,
  caption = "Hakedişler",
}: {
  rows: readonly Payout[];
  caption?: string;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Tarih</TableHeaderCell>
          <TableHeaderCell>Tutar</TableHeaderCell>
          <TableHeaderCell>Durum</TableHeaderCell>
          <TableHeaderCell>Atama</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell>
              <Link href={payoutHref(row.id)} className="text-brand hover:underline">
                {formatDateTime(row.createdAt)}
              </Link>
            </TableCell>
            <TableCell>{formatCurrency(row.amount, row.currency)}</TableCell>
            <TableCell>
              <Badge tone={PAYOUT_TONES[row.status]}>{PAYOUT_STATUS_LABELS[row.status]}</Badge>
            </TableCell>
            <TableCell>
              <Link
                href={assignmentHref(row.jobAssignmentId)}
                className="font-mono text-xs text-brand hover:underline"
              >
                {row.jobAssignmentId}
              </Link>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
