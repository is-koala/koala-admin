import type { Metadata } from "next";

import { IbanVerificationForm } from "@/components/iban-verification/iban-verification-form";
import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { RequirePermission } from "@/server/authz/require-permission";

import { submitIbanVerification } from "./actions";

export const metadata: Metadata = { title: "IBAN doğrulama" };

export default function IbanVerificationsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="IBAN doğrulama"
        description={
          <>
            İşçinin küçük havalesini ekstre satırıyla onaylayın. Bekleyen doğrulamalar listelenmez;
            referans açıklamadaki koddur. <code className="font-mono">bank.account.verify</code>{" "}
            izni gerekir.
          </>
        }
      />

      <RequirePermission permission="bank.account.verify">
        <div className="flex flex-col gap-6">
          <IbanVerificationForm action={submitIbanVerification} />

          <AuditPointer permission="bank.account.verify" linkLabel="IBAN doğrulama kayıtlarını aç">
            Backend başarılı işlemi <code className="font-mono">bank.account.verify</code> adıyla
            kaydeder. Panel, ekstre alanlarının request body olarak denetim kaydında tutulduğunu
            iddia etmez; hata araştırmasında ekrandaki requestId ile backend logları eşleştirilir.
          </AuditPointer>
        </div>
      </RequirePermission>
    </div>
  );
}
