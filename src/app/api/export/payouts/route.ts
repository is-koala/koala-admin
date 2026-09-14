import { getPayouts, type Payout } from "@/server/api/payout-reconciliation";
import { safeUserName } from "@/server/api/users";
import { exportCsv, type ExportSpec } from "@/server/export/csv-export";
import {
  payoutListQuery,
  payoutViewState,
  readPayoutView,
  type PayoutView,
} from "@/server/lists/payouts";

/**
 * Hakediş listesinin CSV'si (koala-admin#110). Kapı `payout.reconcile`;
 * `durum=hepsi` yoksa sayfadaki gibi yalnız PROCESSING gelir. Sayfa tavanı
 * 50: bu uçta `PageableSanitizer` yok, daha büyüğü backend'de kırpılır ve
 * `last` yanlış okunurdu.
 */
const SPEC: ExportSpec<Payout, PayoutView> = {
  list: "payouts",
  permission: "payout.reconcile",
  fileStem: "hakedisler",
  pageSize: 50,
  readView: readPayoutView,
  viewState: payoutViewState,
  fetchPage: (accessToken, view, paging) => getPayouts(accessToken, payoutListQuery(view, paging)),
  columns: [
    { header: "Hakediş kimliği", cell: (row) => row.id },
    { header: "Atama kimliği", cell: (row) => row.jobAssignmentId },
    { header: "Alıcı kimliği", cell: (row) => row.recipient?.id ?? null },
    {
      header: "Alıcı adı",
      cell: (row) => (row.recipient === null ? null : safeUserName(row.recipient)),
      requires: "user.read",
    },
    { header: "Tutar", cell: (row) => row.amount },
    { header: "Para birimi", cell: (row) => row.currency },
    { header: "Durum", cell: (row) => row.status },
    { header: "Başarısızlık nedeni", cell: (row) => row.failureReason },
    { header: "Oluşturulma", cell: (row) => row.createdAt },
    { header: "Tamamlanma", cell: (row) => row.completedAt },
  ],
};

export function GET(request: Request): Promise<Response> {
  return exportCsv(request, SPEC);
}
