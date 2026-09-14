import { getDisputes, type Dispute } from "@/server/api/disputes";
import { safeUserName } from "@/server/api/users";
import { exportCsv, type ExportSpec } from "@/server/export/csv-export";
import {
  disputeListQuery,
  disputeViewState,
  readDisputeView,
  type DisputeView,
} from "@/server/lists/disputes";

/**
 * Uyuşmazlık listesinin CSV'si (koala-admin#110). Kapı `dispute.resolve`;
 * `durum` yoksa sayfadaki gibi bekleyen kuyruk (OPEN + UNDER_REVIEW).
 * Tutar yok: `DisputeDto` tutar taşımaz, atama özetini bin kez okumak
 * bir dışa aktarma için değil.
 */
const SPEC: ExportSpec<Dispute, DisputeView> = {
  list: "disputes",
  permission: "dispute.resolve",
  fileStem: "uyusmazliklar",
  readView: readDisputeView,
  viewState: disputeViewState,
  fetchPage: (accessToken, view, paging) =>
    getDisputes(accessToken, disputeListQuery(view, paging)),
  columns: [
    { header: "Uyuşmazlık kimliği", cell: (row) => row.id },
    { header: "Atama kimliği", cell: (row) => row.jobAssignmentId },
    { header: "Açan kimliği", cell: (row) => row.openedBy?.id ?? null },
    {
      header: "Açan adı",
      cell: (row) => (row.openedBy === null ? null : safeUserName(row.openedBy)),
      requires: "user.read",
    },
    { header: "Açan taraf", cell: (row) => row.openedBySide },
    { header: "Durum", cell: (row) => row.status },
    { header: "Neden", cell: (row) => row.reason },
    { header: "Çözüm", cell: (row) => row.resolution },
    { header: "Çözüm notu", cell: (row) => row.resolutionNote },
    { header: "Çözen personel kimliği", cell: (row) => row.resolvedByStaffId },
    { header: "Çözüm zamanı", cell: (row) => row.resolvedAt },
    { header: "Oluşturulma", cell: (row) => row.createdAt },
  ],
};

export function GET(request: Request): Promise<Response> {
  return exportCsv(request, SPEC);
}
