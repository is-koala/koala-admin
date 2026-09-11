import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { ErrorState } from "@/components/ui";
import { presentSettings } from "@/lib/runtime-settings";
import { isKoalaApiError } from "@/server/api/errors";
import { getRuntimeSettings } from "@/server/api/settings";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";

import { submitSettingUpdate } from "./actions";
import { SettingsManager } from "./settings-manager";

export const metadata: Metadata = { title: "Çalışma zamanı ayarları" };

/**
 * The `settings.manage` screen — policy numbers without a deploy.
 *
 * The fetch lives in the child element so the gate withholding it withholds
 * the authenticated management request too. The mutation independently
 * repeats the permission decision in its Server Action.
 */
export default async function SettingsPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Çalışma zamanı ayarları"
        description={
          <>Politika sayılarını deploy olmadan değiştirin. Oranlar 0 ile 1 arasında olmalıdır.</>
        }
      />

      <RequirePermission permission="settings.manage">
        <SettingsTable />
      </RequirePermission>
    </div>
  );
}

async function SettingsTable() {
  let stored;
  try {
    stored = await getRuntimeSettings(await getKoalaAccessToken());
  } catch (error) {
    return (
      <ErrorState
        title="Ayarlar yüklenemedi."
        description={
          isKoalaApiError(error)
            ? error.message
            : error instanceof Error
              ? error.message
              : "Bilinmeyen bir hata oluştu."
        }
        errorCode={isKoalaApiError(error) ? error.errorCode : null}
        requestId={isKoalaApiError(error) ? error.requestId : null}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <SettingsManager settings={presentSettings(stored)} updateAction={submitSettingUpdate} />

      <AuditPointer permission="settings.manage" linkLabel="Ayar değişiklik kayıtlarını aç">
        Backend başarılı yazımı <code className="font-mono">setting.update</code> adıyla kaydeder.
        Tabloda satırı olmayan bir anahtar yaml varsayılanına düşer; panel o varsayılanı katalogdan
        gösterir.
      </AuditPointer>
    </div>
  );
}
