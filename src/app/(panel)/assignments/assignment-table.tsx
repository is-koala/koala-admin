import Link from "next/link";

import { CompanyLink } from "@/components/panel/company-link";
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
import { assignmentHref, jobHref } from "@/lib/panel-href";
import type { EscrowSummary } from "@/server/api/escrow";

import { StaffFlagBadges } from "@/components/panel/staff-flag-badges";
import type { StaffFlag } from "@/server/api/staff-notes";

import { ASSIGNMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from "./labels";

/**
 * Atama kuyruğunun tablosu; kuyruk sayfası ve kullanıcı sayfasının "Atamalar"
 * sekmesi (koala-admin#103) aynı satırı çizer. Süzme ve sayfalama burada
 * değil: gelen sayfa olduğu gibi çizilir.
 *
 * Her ad tıklanır (koala-admin#105): işçi ve işveren `SafeUserLink` ile
 * kullanıcı sayfasına; ilan `job.read`, şirket `company.approve` varken
 * kendi sayfasına. İzin bayrakları çağırandan gelir ve varsayılanı kapalı —
 * bayrağı vermeyen bir çağıran (kullanıcı sekmesi) düz metin alır, izni
 * olmayan birini 403 ekranına gönderen bir bağlantı çizmez.
 */
export function AssignmentTable({
  rows,
  caption = "Atamalar",
  objectQuery = {},
  canOpenJob = false,
  canOpenCompany = false,
  flagsById,
}: {
  rows: readonly EscrowSummary[];
  caption?: string;
  /** Satır bağlantısına eklenen liste görünümü; nesne sayfasının kırıntısı geri okur. */
  objectQuery?: Readonly<Record<string, string>>;
  /** `job.read` — ilan başlığı `/jobs/{id}`'ye bağlanır. */
  canOpenJob?: boolean;
  /** `company.approve` — şirket adı `/companies/{id}`'ye bağlanır (kimlik geldiyse). */
  canOpenCompany?: boolean;
  flagsById?: ReadonlyMap<string, readonly StaffFlag[]>;
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
            <TableCell>
              {row.jobTitle === null ? (
                EMPTY_VALUE
              ) : canOpenJob ? (
                <Link href={jobHref(row.jobId)} className="text-brand hover:underline">
                  {row.jobTitle}
                </Link>
              ) : (
                row.jobTitle
              )}
            </TableCell>
            <TableCell>
              <SafeUserLink user={row.worker} />
            </TableCell>
            <TableCell>
              <SafeUserLink user={row.employer} />
              {row.companyName === null ? null : (
                <>
                  {" · "}
                  <CompanyLink
                    companyId={row.companyId}
                    companyName={row.companyName}
                    canOpen={canOpenCompany}
                  />
                </>
              )}
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
              <span className="flex flex-wrap items-center gap-2">
                <Link
                  href={assignmentHref(row.id, objectQuery)}
                  className="text-sm font-medium text-brand hover:underline"
                >
                  Aç
                </Link>
                <StaffFlagBadges flags={flagsById?.get(row.id) ?? []} />
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
