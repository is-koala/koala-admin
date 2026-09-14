import { safeUserName } from "@/server/api/users";
import { getAdminAssignments, type EscrowSummary } from "@/server/api/escrow";
import { exportCsv, type ExportSpec } from "@/server/export/csv-export";
import {
  assignmentListQuery,
  assignmentViewState,
  readAssignmentView,
} from "@/server/lists/assignments";

/**
 * Atama listesinin CSV'si (koala-admin#110). Kapı sayfayla aynı: `payment.read`.
 * Süzgeçler `readAssignmentView` — sayfa hangi adresi okuyorsa rota da onu okur.
 */
const SPEC: ExportSpec<EscrowSummary> = {
  list: "assignments",
  permission: "payment.read",
  fileStem: "atamalar",
  readView: (params) => {
    const view = readAssignmentView(params);
    return { paging: view.paging, state: assignmentViewState(view) };
  },
  fetchPage: (accessToken, params, page) => {
    const view = readAssignmentView(params);
    return getAdminAssignments(
      accessToken,
      assignmentListQuery(view, { ...view.paging, page: page.page, size: page.size }),
    );
  },
  columns: [
    { header: "Atama kimliği", cell: (row) => row.id },
    { header: "İlan kimliği", cell: (row) => row.jobId },
    { header: "İlan başlığı", cell: (row) => row.jobTitle },
    { header: "Şirket kimliği", cell: (row) => row.companyId },
    { header: "Şirket adı", cell: (row) => row.companyName },
    { header: "İşçi kimliği", cell: (row) => row.worker.id },
    { header: "İşçi adı", cell: (row) => safeUserName(row.worker), pii: true },
    { header: "İşveren kimliği", cell: (row) => row.employer.id },
    { header: "İşveren adı", cell: (row) => safeUserName(row.employer), pii: true },
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
