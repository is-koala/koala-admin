import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { objectBreadcrumb, readQueueState } from "@/lib/breadcrumb";
import { isUuid } from "@/lib/panel-href";
import { getAccountDeletion } from "@/server/api/account-deletions";
import type { SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";
import { resolveStaffRefs } from "@/server/staff/staff-refs";

import { DeletionReviewBody, DeletionStatusBadge } from "../deletion-detail";

export const metadata: Metadata = { title: "Hesap silme talebi" };

/**
 * Hesap silme nesne sayfası. Ret burada; kuyruk yalnız listeler.
 * GET /admin/account-deletions/{id}. Kapı `user.read_pii`. Ret ayrıca
 * `user.deletion.manage` ister — form ve Server Action. Ret gerekçesi,
 * reddeden personel ve canlı engelleyiciler koala-backend#283 ile geldi
 * (koala-admin#100); eski sunucuda satırlar yok ya da "—".
 */
export default async function AccountDeletionDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hesap silme talebi"
        breadcrumb={objectBreadcrumb("/account-deletions", id, readQueueState(query))}
        description="Anonimleştirme zamanlayıcı işidir — panel onaylamaz, yalnız reddeder."
      />

      <RequirePermission permission="user.read_pii">
        <DeletionObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function DeletionObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const context = await getStaffContext();
  const canReject = context.has("user.deletion.manage");
  const accessToken = await getKoalaAccessToken();

  let row;
  try {
    row = await getAccountDeletion(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Hesap silme talebi"
        permission="user.read_pii"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="font-mono text-lg font-semibold">{row.id.slice(0, 8)}</h2>
        <DeletionStatusBadge status={row.status} />
      </div>
      <DeletionReviewBody
        row={row}
        canReject={canReject}
        permissions={context.staff?.permissions ?? []}
        staffRefs={await resolveStaffRefs([row.rejectedByStaffId], { accessToken, context })}
      />
      <ObjectAuditPointer resourceId={row.id} linkLabel="Bu talebin denetim kayıtlarını aç">
        Ret backend tarafından bu talep kimliğiyle denetim kaydına yazılır; personelin bu kaydı
        açması da kayda düşer.
      </ObjectAuditPointer>
    </section>
  );
}
