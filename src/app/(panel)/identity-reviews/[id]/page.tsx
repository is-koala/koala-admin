import Link from "next/link";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { identityReviewsHref, isUuid } from "@/lib/panel-href";
import { getIdentityReview } from "@/server/api/identity-reviews";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { IdentityReviewBody, IdentityStatusBadge, identityDisplayName } from "../identity-review";

export const metadata: Metadata = { title: "Kimlik incelemesi" };

const QUEUE_KEYS = ["durum", "sirala", "boyut", "sayfa"] as const;

/**
 * Kuyruk süzgecini nesne URL'sinden geri taşımak için. Karar sonrası dönüş
 * her zaman `/identity-reviews` — nesne sayfasında kalmaz.
 */
function queueReturnTo(params: SearchParams): Route {
  const state: Record<string, string> = {};
  for (const key of QUEUE_KEYS) {
    const value = readParam(params, key);
    if (value !== null && value.length > 0) state[key] = value;
  }
  return identityReviewsHref(state);
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
        description={
          <>
            Onay kimlik damgasını çip olmadan koyar ve geri alınamaz.{" "}
            <Link href={returnTo} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
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
  if (!isUuid(id)) {
    return (
      <p className="text-sm text-ink-muted">İnceleme kimliği geçersiz. Kuyruktan bir satır açın.</p>
    );
  }

  let review;
  try {
    review = await getIdentityReview(await getKoalaAccessToken(), id);
  } catch (error) {
    return (
      <QueueLoadFailure
        subject="Kimlik incelemesi"
        permission="identity.review"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      {decisionResult === null ? null : (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {decisionResult === "approved" ? "Onay" : "Ret"} kararı backend tarafından kaydedildi.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-lg font-semibold">{identityDisplayName(review)}</h2>
        <IdentityStatusBadge status={review.status} />
      </div>
      <IdentityReviewBody review={review} returnTo={returnTo} />
    </section>
  );
}
