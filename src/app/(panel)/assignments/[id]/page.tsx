import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { objectBreadcrumb, readQueueState } from "@/lib/breadcrumb";
import { isUuid } from "@/lib/panel-href";
import { isKoalaApiError } from "@/server/api/errors";
import { getAssignmentDetail } from "@/server/api/escrow";
import type { SearchParams } from "@/server/api/paging";
import { getAssignmentPayments } from "@/server/api/payments";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { AssignmentDetail, type PaymentsResult } from "../assignment-detail";

export const metadata: Metadata = { title: "Atama" };

/**
 * Atama nesne sayfası (koala-admin#95). `GET /admin/job-assignments/{id}`
 * artık `AdminAssignmentDetailDto` döner; ödeme denemeleri
 * `GET .../{id}/payments`. İkisi de `payment.read`; kapı aynı izin ve izni
 * olmayan kişide GET hiç çıkmaz. Para düğmeleri `runEscrowOperation`'dan
 * geçer — sayfanın kapısı onları korumaz, o kendi iznini yeniden çözer.
 */
export default async function AssignmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Atama"
        breadcrumb={objectBreadcrumb("/assignments", id, readQueueState(query))}
        description="Atama, ilan, taraflar, ödeme denemeleri ve hakediş tek ekranda."
      />

      <RequirePermission permission="payment.read">
        <AssignmentObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function AssignmentObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();

  let assignment;
  try {
    assignment = await getAssignmentDetail(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Atama detayı"
        permission="payment.read"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const payments = await loadPayments(accessToken, assignment.id);

  return (
    <div className="flex flex-col gap-6">
      <AssignmentDetail
        assignment={assignment}
        payments={payments}
        permissions={context.staff?.permissions ?? []}
      />
      <ObjectAuditPointer resourceId={assignment.id} linkLabel="Bu atamanın denetim kayıtlarını aç">
        Serbest bırakma ve iade backend tarafından bu atama kimliğiyle denetim kaydına yazılır;
        personelin bu kaydı açması da kayda düşer.
      </ObjectAuditPointer>
    </div>
  );
}

/**
 * Denemeler ayrı uçtan gelir ve ayrı düşer. Atama okunduysa sayfa durur;
 * tablo yerine hata kutusu çizilir. Buradaki 404 `notFound()` değildir —
 * atama var, yalnız denemeler okunamadı.
 */
async function loadPayments(accessToken: string, assignmentId: string): Promise<PaymentsResult> {
  try {
    return { ok: true, payments: await getAssignmentPayments(accessToken, assignmentId) };
  } catch (error) {
    return {
      ok: false,
      failure: {
        message: isKoalaApiError(error)
          ? error.message
          : error instanceof Error
            ? error.message
            : "Bilinmeyen bir hata oluştu.",
        errorCode: isKoalaApiError(error) ? error.errorCode : "UNEXPECTED",
        requestId: isKoalaApiError(error) ? error.requestId : null,
      },
    };
  }
}
