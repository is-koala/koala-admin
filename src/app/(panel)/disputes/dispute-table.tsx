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
import { assignmentHref, disputeHref, userHrefOrNull } from "@/lib/panel-href";
import type { Dispute } from "@/server/api/disputes";
import { safeUserName } from "@/server/api/users";

import { StaffFlagBadges } from "@/components/panel/staff-flag-badges";
import type { StaffFlag } from "@/server/api/staff-notes";

import { DISPUTE_STATUS_LABELS, DISPUTE_STATUS_TONES, type SummaryEntry } from "./dispute-detail";

/**
 * Uyuşmazlık kuyruğunun tablosu; kuyruk sayfası ve kullanıcı sayfasının
 * "Uyuşmazlıklar" sekmesi (koala-admin#103) aynı satırı çizer. Tutar sütunu
 * `DisputeDto`'da yok, atama özetinden gelir (`loadSummaries`); özeti olmayan
 * satır "—" yazar, panel tutar uydurmaz.
 */
export function DisputeTable({
  disputes,
  summaries,
  caption,
  objectQuery = {},
  flagsById,
}: {
  disputes: readonly Dispute[];
  summaries: ReadonlyMap<string, SummaryEntry>;
  caption: string;
  /** Satır bağlantısına eklenen liste görünümü; nesne sayfasının kırıntısı geri okur. */
  objectQuery?: Readonly<Record<string, string>>;
  flagsById?: ReadonlyMap<string, readonly StaffFlag[]>;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Durum</TableHeaderCell>
          <TableHeaderCell>Açan taraf</TableHeaderCell>
          <TableHeaderCell>Atama</TableHeaderCell>
          <TableHeaderCell>Emanetteki tutar</TableHeaderCell>
          <TableHeaderCell>Açılış</TableHeaderCell>
          <TableHeaderCell>Detay</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {disputes.map((dispute) => {
          const entry = summaries.get(dispute.jobAssignmentId);
          const openedByHref = userHrefOrNull(dispute.openedBy?.id);
          return (
            <TableRow key={dispute.id}>
              <TableCell>
                <Badge tone={DISPUTE_STATUS_TONES[dispute.status]}>
                  {DISPUTE_STATUS_LABELS[dispute.status]}
                </Badge>
              </TableCell>
              <TableCell>
                {openedByHref === null ? (
                  safeUserName(dispute.openedBy)
                ) : (
                  <Link href={openedByHref} className="text-brand hover:underline">
                    {safeUserName(dispute.openedBy)}
                  </Link>
                )}
              </TableCell>
              <TableCell>
                <Link
                  href={assignmentHref(dispute.jobAssignmentId)}
                  className="font-mono text-xs text-brand hover:underline"
                >
                  {dispute.jobAssignmentId}
                </Link>
              </TableCell>
              <TableCell>
                {entry !== undefined && entry.ok
                  ? formatCurrency(
                      entry.summary.pricing.employerTotal,
                      entry.summary.pricing.currency,
                    )
                  : EMPTY_VALUE}
              </TableCell>
              <TableCell>{formatDateTime(dispute.createdAt)}</TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={disputeHref(dispute.id, objectQuery)}
                    className="text-sm font-medium text-brand hover:underline"
                  >
                    İncele
                  </Link>
                  <StaffFlagBadges flags={flagsById?.get(dispute.id) ?? []} />
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
