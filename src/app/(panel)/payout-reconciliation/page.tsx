import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { PayoutReconciliationForm } from "@/components/payout-reconciliation/payout-reconciliation-form";
import { RequirePermission } from "@/server/authz/require-permission";

import { submitPayoutReconciliation } from "./actions";

export const metadata: Metadata = { title: "Hakediş banka mutabakatı" };

export default function PayoutReconciliationPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hakediş banka mutabakatı"
        description={
          <>
            Banka ekstresindeki gerçekleşmiş transferi bir hakediş kaydıyla eşleştirin. Bekleyen
            kuyruk yoksa kimliği runbook&apos;tan yazın.
          </>
        }
      />

      <RequirePermission permission="payout.reconcile">
        <div className="flex flex-col gap-6">
          <PayoutReconciliationForm action={submitPayoutReconciliation} />

          <AuditPointer permission="payout.reconcile" linkLabel="Hakediş mutabakat kayıtlarını aç">
            Backend başarılı işlemi <code className="font-mono">payout.reconcile</code> adıyla
            kaydeder. Panel, bu formdaki kanıt alanlarının request body olarak denetim kaydında
            tutulduğunu iddia etmez; hata araştırmasında ekrandaki requestId ile backend logları
            eşleştirilir.
          </AuditPointer>
        </div>
      </RequirePermission>
    </div>
  );
}
