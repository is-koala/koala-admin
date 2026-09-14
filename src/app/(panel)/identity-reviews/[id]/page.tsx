import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { objectBreadcrumb, readQueueState } from "@/lib/breadcrumb";
import { identityReviewsHref, isUuid } from "@/lib/panel-href";
import { getIdentityReview } from "@/server/api/identity-reviews";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { SignedDownloadAllowlistNotice } from "@/server/evidence/signed-download-notice";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";
import { resolveStaffRefs } from "@/server/staff/staff-refs";

import { IdentityReviewBody, IdentityStatusBadge, identityDisplayName } from "../identity-review";

export const metadata: Metadata = { title: "Kimlik incelemesi" };

/**
 * Kuyruk süzgecini nesne URL'sinden geri taşımak için. Karar sonrası dönüş
 * her zaman `/identity-reviews` — nesne sayfasında kalmaz. Kırıntı da aynı
 * adresi kullanır (koala-admin#112).
 */
function queueReturnTo(params: SearchParams): Route {
  return identityReviewsHref(readQueueState(params));
}

/**
 * Kimlik inceleme nesne sayfası. Onay ve ret burada; kuyruk yalnız listeler.
 * GET /admin/identity-verifications/{id}. Kapı `identity.review`: izni olmayan
 * kişide GET çıkmaz.
 */
export default async function IdentityReviewDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const returnTo = queueReturnTo(query);
  const rawDecisionResult = readParam(query, "sonuc");
  const decisionResult =
    rawDecisionResult === "approved" || rawDecisionResult === "rejected" ? rawDecisionResult : null;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kimlik incelemesi"
        breadcrumb={objectBreadcrumb("/identity-reviews", id, readQueueState(query))}
        description="Onay kimlik damgasını çip olmadan koyar ve geri alınamaz."
      />

      <RequirePermission permission="identity.review">
        <IdentityObject id={id} decisionResult={decisionResult} returnTo={returnTo} />
      </RequirePermission>
    </div>
  );
}

async function IdentityObject({
  id,
  decisionResult,
  returnTo,
}: {
  id: string;
  decisionResult: "approved" | "rejected" | null;
  returnTo: string;
}) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const accessToken = await getKoalaAccessToken();

  let review;
  try {
    review = await getIdentityReview(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Kimlik incelemesi"
        permission="identity.review"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  // Backend adı zaten veriyorsa (`reviewedByStaffName`) ikinci istek çıkmaz;
  // eski sunucuda ad yoktur, `staff.read` varsa `GET /admin/staff/{id}` çözer.
  const staffRefs =
    review.reviewedByStaffId === null
      ? {}
      : await resolveStaffRefs(
          [{ id: review.reviewedByStaffId, name: review.reviewedByStaffName }],
          {
            accessToken,
            context: await getStaffContext(),
          },
        );

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      <SignedDownloadAllowlistNotice subject="TCKK fotoğrafları" />
      {decisionResult === null ? null : (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {decisionResult === "approved" ? "Onay" : "Ret"} kararı backend tarafından kaydedildi.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{identityDisplayName(review)}</h2>
        <IdentityStatusBadge status={review.status} />
      </div>
      <IdentityReviewBody review={review} returnTo={returnTo} staffRefs={staffRefs} />
      <ObjectAuditPointer resourceId={review.id} linkLabel="Bu incelemenin denetim kayıtlarını aç">
        Onay ve ret backend tarafından bu inceleme kimliğiyle denetim kaydına yazılır; personelin bu
        kaydı açması da kayda düşer.
      </ObjectAuditPointer>
    </section>
  );
}
