import Link from "next/link";

import { SEARCH_PARAM } from "@/components/panel/queue";
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
import { EMPTY_VALUE, formatCurrency, formatDateTime } from "@/lib/format";
import { assignmentHref, payoutHref } from "@/lib/panel-href";
import { PAYOUT_STATUS_LABELS, type Payout } from "@/server/api/payout-reconciliation";

import { PAYOUT_STATUS_TONES } from "./labels";

/**
 * Onay sütununun bağlamı. Kuyruk sayfası verir: satırdan onaya geçiş aynı
 * sayfada `?hakedis=` ile formu doldurur, sayfa ve aramayı taşır. Kullanıcı
 * sayfasının sekmesi (koala-admin#103) vermez — mutabakat kuyruğun işi.
 */
export interface PayoutActionContext {
  readonly selectedId: string | null;
  readonly page: number;
  /** Satırdan onaya geçmek aramayı silmesin. */
  readonly query: string | null;
}

/**
 * Hakediş tablosu; mutabakat kuyruğu ve kullanıcı sayfasının "Hakedişler"
 * sekmesi aynı satırı çizer. Rozet DTO'nun `status` alanından; "Onayla"
 * yalnız PROCESSING satırında ve yalnız `action` verildiğinde (koala-admin#106).
 */
export function PayoutTable({
  rows,
  caption = "Hakedişler",
  action,
}: {
  rows: readonly Payout[];
  caption?: string;
  action?: PayoutActionContext;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Tarih</TableHeaderCell>
          <TableHeaderCell>İşçi</TableHeaderCell>
          <TableHeaderCell>Tutar</TableHeaderCell>
          <TableHeaderCell>Durum</TableHeaderCell>
          <TableHeaderCell>Atama</TableHeaderCell>
          {action === undefined ? null : <TableHeaderCell>Onay</TableHeaderCell>}
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
            <TableCell>
              <SafeUserLink user={row.recipient} />
            </TableCell>
            <TableCell>{formatCurrency(row.amount, row.currency)}</TableCell>
            <TableCell>
              <Badge tone={PAYOUT_STATUS_TONES[row.status]}>
                {PAYOUT_STATUS_LABELS[row.status]}
              </Badge>
            </TableCell>
            <TableCell>
              <Link
                href={assignmentHref(row.jobAssignmentId)}
                className="font-mono text-xs text-brand hover:underline"
              >
                {row.jobAssignmentId}
              </Link>
            </TableCell>
            {action === undefined ? null : (
              <TableCell>
                <ReconcileCell row={row} action={action} />
              </TableCell>
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function ReconcileCell({ row, action }: { row: Payout; action: PayoutActionContext }) {
  if (row.status !== "PROCESSING") return <span className="text-ink-muted">{EMPTY_VALUE}</span>;
  if (row.id === action.selectedId) return <Badge tone="brand">Seçili</Badge>;
  return (
    <Link
      href={{
        pathname: "/payout-reconciliation",
        query: {
          hakedis: row.id,
          ...(action.page > 0 ? { sayfa: String(action.page) } : {}),
          ...(action.query === null ? {} : { [SEARCH_PARAM]: action.query }),
        },
      }}
      className="text-sm font-medium text-brand hover:underline"
    >
      Onayla
    </Link>
  );
}
