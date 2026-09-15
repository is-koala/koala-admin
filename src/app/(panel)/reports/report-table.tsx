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
import { EMPTY_VALUE, formatDateTime, formatInteger } from "@/lib/format";
import { reportHref, userHref, userHrefOrNull } from "@/lib/panel-href";
import {
  reportPartyName,
  reportReasonLabel,
  reportStatusLabel,
  reportTargetLabel,
  reportTargets,
  type Report,
} from "@/server/api/reports";

import { StaffFlagBadges } from "@/components/panel/staff-flag-badges";
import type { StaffFlag } from "@/server/api/staff-notes";

import { REPORT_STATUS_TONES } from "./report-decision";

/**
 * Şikayet kuyruğunun tablosu; kuyruk sayfası ve kullanıcı sayfasının
 * "Şikayetler" sekmesi (koala-admin#103) aynı satırı çizer. Gelen sayfa
 * panelde süzülmez.
 */
export function ReportTable({
  reports,
  caption = "Şikayet kuyruğu",
  objectQuery = {},
  flagsById,
}: {
  reports: readonly Report[];
  caption?: string;
  /** Satır bağlantısına eklenen liste görünümü; nesne sayfasının kırıntısı geri okur. */
  objectQuery?: Readonly<Record<string, string>>;
  flagsById?: ReadonlyMap<string, readonly StaffFlag[]>;
}) {
  return (
    <Table caption={caption}>
      <TableHead>
        <TableRow>
          <TableHeaderCell>Tarih</TableHeaderCell>
          <TableHeaderCell>Durum</TableHeaderCell>
          <TableHeaderCell>Gerekçe</TableHeaderCell>
          <TableHeaderCell>Şikayet eden</TableHeaderCell>
          <TableHeaderCell>Şikayet edilen</TableHeaderCell>
          <TableHeaderCell>Geçmiş</TableHeaderCell>
          <TableHeaderCell>Hedef</TableHeaderCell>
          <TableHeaderCell>Detay</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {reports.map((report) => {
          const reporterHref = userHrefOrNull(report.reporter?.id);
          return (
            <TableRow key={report.id}>
              <TableCell>{formatDateTime(report.createdAt)}</TableCell>
              <TableCell>
                <Badge tone={REPORT_STATUS_TONES[report.status] ?? "neutral"}>
                  {reportStatusLabel(report.status)}
                </Badge>
              </TableCell>
              <TableCell>{reportReasonLabel(report.reason)}</TableCell>
              <TableCell>
                {report.reporter === null ? (
                  EMPTY_VALUE
                ) : reporterHref === null ? (
                  reportPartyName(report.reporter)
                ) : (
                  <Link href={reporterHref} className="text-brand hover:underline">
                    {reportPartyName(report.reporter)}
                  </Link>
                )}
              </TableCell>
              <TableCell>
                {report.reportedUserId === null ? (
                  EMPTY_VALUE
                ) : (
                  <Link
                    href={userHref(report.reportedUserId)}
                    className="text-brand hover:underline"
                  >
                    {reportPartyName(report.reportedUser)}
                  </Link>
                )}
              </TableCell>
              <TableCell>
                {report.reportedUserId === null
                  ? EMPTY_VALUE
                  : formatInteger(report.reportedUserReportCount)}
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap gap-1">
                  {reportTargets(report).map((target) => (
                    <Badge key={`${target.kind}-${target.id}`}>
                      {reportTargetLabel(target.kind)}
                    </Badge>
                  ))}
                  {reportTargets(report).length === 0 ? EMPTY_VALUE : null}
                </span>
              </TableCell>
              <TableCell>
                <span className="flex flex-wrap items-center gap-2">
                  <Link
                    href={reportHref(report.id, objectQuery)}
                    className="text-brand hover:underline"
                  >
                    İncele
                  </Link>
                  <StaffFlagBadges flags={flagsById?.get(report.id) ?? []} />
                </span>
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
