import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { isUuid } from "@/lib/panel-href";
import { isKoalaApiError } from "@/server/api/errors";
import { getAssignmentDetail } from "@/server/api/escrow";
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Atama"
        description={
          <>
            Atama, ilan, taraflar, ödeme denemeleri ve hakediş tek ekranda.{" "}
            <Link href={"/assignments" as Route} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
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
    <AssignmentDetail
      assignment={assignment}
      payments={payments}
      permissions={context.staff?.permissions ?? []}
    />
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
