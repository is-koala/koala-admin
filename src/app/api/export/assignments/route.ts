import { safeUserName } from "@/server/api/users";
import { getAdminAssignments, type EscrowSummary } from "@/server/api/escrow";
import { exportCsv, type ExportSpec } from "@/server/export/csv-export";
import {
  assignmentListQuery,
  assignmentViewState,
  readAssignmentView,
  type AssignmentView,
} from "@/server/lists/assignments";

/**
 * Atama listesinin CSV'si (koala-admin#110). Kapı sayfayla aynı: `payment.read`.
 * Süzgeçler `readAssignmentView` — sayfa hangi adresi okuyorsa rota da onu okur.
 */
const SPEC: ExportSpec<EscrowSummary, AssignmentView> = {
  list: "assignments",
  permission: "payment.read",
  fileStem: "atamalar",
  readView: readAssignmentView,
  viewState: assignmentViewState,
  fetchPage: (accessToken, view, paging) =>
    getAdminAssignments(accessToken, assignmentListQuery(view, paging)),
  columns: [
    { header: "Atama kimliği", cell: (row) => row.id },
    { header: "İlan kimliği", cell: (row) => row.jobId },
    { header: "İlan başlığı", cell: (row) => row.jobTitle },
    { header: "Şirket kimliği", cell: (row) => row.companyId },
    { header: "Şirket adı", cell: (row) => row.companyName },
    { header: "İşçi kimliği", cell: (row) => row.worker.id },
    { header: "İşçi adı", cell: (row) => safeUserName(row.worker), requires: "user.read" },
    { header: "İşveren kimliği", cell: (row) => row.employer.id },
    { header: "İşveren adı", cell: (row) => safeUserName(row.employer), requires: "user.read" },
    { header: "Atama durumu", cell: (row) => row.status },
    { header: "Ödeme durumu", cell: (row) => row.paymentStatus },
    { header: "Atama zamanı", cell: (row) => row.assignmentDateTime },
    { header: "Tamamlanma", cell: (row) => row.actualCompletionDateTime },
    { header: "Çalışma saati", cell: (row) => row.workHours },
    { header: "İşçiye ödenecek", cell: (row) => row.pricing.workerPayout },
    { header: "Komisyon", cell: (row) => row.pricing.serviceFeeAmount },
    { header: "İşverenden tahsil edilen", cell: (row) => row.pricing.employerTotal },
    { header: "Para birimi", cell: (row) => row.pricing.currency },
  ],
};

export function GET(request: Request): Promise<Response> {
  return exportCsv(request, SPEC);
}
