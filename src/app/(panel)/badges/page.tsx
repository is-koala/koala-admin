import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { ErrorState } from "@/components/ui";
import { isKoalaApiError } from "@/server/api/errors";
import { getManagedBadges, type AdminBadge } from "@/server/api/badges";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";

import {
  submitBadgeActivation,
  submitBadgeCreate,
  submitBadgeIcon,
  submitBadgeUpdate,
} from "./actions";
import { BadgeManager } from "./badge-manager";

export const metadata: Metadata = { title: "Rozetler" };

/**
 * `badge.manage` ekranı — katalog oluştur/güncelle/ikon/etkinlik.
 *
 * Fetch çocukta duruyor ki kapı onu da kessin; yoksa 403 HTML'inin arkasında
 * yine `GET /admin/badges` giderdi. Her yazım Server Action'da izni yeniden
 * çözer: sayfa kapısı o POST uçlarını korumaz.
 */
export default async function BadgesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Rozetler</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Katalogdaki rozetleri oluşturun, düzenleyin, ikon yükleyin veya pasifleştirin. Pasif rozet
          yeni kimseye verilmez; sahiplerinde kalır. <code className="font-mono">badge.manage</code>{" "}
          izni gerekir.
        </p>
      </header>

      <RequirePermission permission="badge.manage">
        <BadgeTable />
      </RequirePermission>
    </div>
  );
}

async function BadgeTable() {
  let badges: AdminBadge[];

  try {
    badges = await getManagedBadges(await getKoalaAccessToken());
  } catch (error) {
    return (
      <ErrorState
        title="Rozetler yüklenemedi."
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
      <BadgeManager
        badges={badges}
        createAction={submitBadgeCreate}
        updateAction={submitBadgeUpdate}
        iconAction={submitBadgeIcon}
        activationAction={submitBadgeActivation}
      />

      <AuditPointer permission="badge.manage" linkLabel="Rozet değişiklik kayıtlarını aç">
        Backend oluşturmayı <code className="font-mono">badge.create</code>, güncellemeyi{" "}
        <code className="font-mono">badge.update</code>, ikonu{" "}
        <code className="font-mono">badge.icon.set</code>, etkinliği{" "}
        <code className="font-mono">badge.activation.set</code> adıyla kaydeder.
      </AuditPointer>
    </div>
  );
}
