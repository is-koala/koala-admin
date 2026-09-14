import { getReports, type Report } from "@/server/api/reports";
import { safeUserName } from "@/server/api/users";
import { exportCsv, type ExportSpec } from "@/server/export/csv-export";
import {
  readReportView,
  reportListQuery,
  reportViewState,
  type ReportView,
} from "@/server/lists/reports";

/**
 * Şikayet listesinin CSV'si (koala-admin#110). Kapı `content.moderate`;
 * durum varsayılanı sayfadaki gibi OPEN, `durum=hepsi` her durum.
 */
const SPEC: ExportSpec<Report, ReportView> = {
  list: "reports",
  permission: "content.moderate",
  fileStem: "sikayetler",
  readView: readReportView,
  viewState: reportViewState,
  fetchPage: (accessToken, view, paging) => getReports(accessToken, reportListQuery(view, paging)),
  columns: [
    { header: "Şikayet kimliği", cell: (row) => row.id },
    { header: "Oluşturulma", cell: (row) => row.createdAt },
    { header: "Durum", cell: (row) => row.status },
    { header: "Neden", cell: (row) => row.reason },
    { header: "Şikayet eden kimliği", cell: (row) => row.reporter?.id ?? null },
    {
      header: "Şikayet eden adı",
      cell: (row) => (row.reporter === null ? null : safeUserName(row.reporter)),
      requires: "user.read",
    },
    { header: "Şikayet edilen kimliği", cell: (row) => row.reportedUser?.id ?? row.reportedUserId },
    {
      header: "Şikayet edilen adı",
      cell: (row) => (row.reportedUser === null ? null : safeUserName(row.reportedUser)),
      requires: "user.read",
    },
    { header: "İlan kimliği", cell: (row) => row.jobId },
    { header: "Atama kimliği", cell: (row) => row.jobAssignmentId },
    { header: "Mesaj kimliği", cell: (row) => row.messageId },
    { header: "Görsel kimliği", cell: (row) => row.imageId },
    { header: "Açıklama", cell: (row) => row.description },
    { header: "İnceleyen personel kimliği", cell: (row) => row.reviewedByStaffId },
    { header: "İnceleme notu", cell: (row) => row.reviewNote },
    { header: "İnceleme zamanı", cell: (row) => row.reviewedAt },
    { header: "Şikayet edilenin toplam şikayeti", cell: (row) => row.reportedUserReportCount },
  ],
};

export function GET(request: Request): Promise<Response> {
  return exportCsv(request, SPEC);
}
