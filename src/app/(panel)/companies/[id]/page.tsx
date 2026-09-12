import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { companiesHref, isUuid } from "@/lib/panel-href";
import { getCompany } from "@/server/api/companies";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { CompanyReviewBody, DecisionDeliveryNotice } from "../company-review";

export const metadata: Metadata = { title: "Şirket" };

const QUEUE_KEYS = ["durum", "ara", "sirala", "boyut", "sayfa"] as const;

/**
 * Kuyruk süzgecini nesne URL'sinden geri taşımak için. Karar sonrası dönüş
 * her zaman `/companies` — nesne sayfasında kalmaz.
 */
function queueReturnTo(params: SearchParams): Route {
  const state: Record<string, string> = {};
  for (const key of QUEUE_KEYS) {
    const value = readParam(params, key);
    if (value !== null && value.length > 0) state[key] = value;
  }
  return companiesHref(state);
}

/**
 * Şirket nesne sayfası. Onay ve ret burada; kuyruk yalnız listeler.
 * GET /admin/companies/{id}. Kapı `company.approve`: izni olmayan kişide GET
 * çıkmaz.
 */
export default async function CompanyDetailPage({
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
        title="Şirket başvurusu"
        description={
          <>
            Onay geri alınamaz.{" "}
            <Link href={returnTo} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
      />

      <RequirePermission permission="company.approve">
        <CompanyObject id={id} decisionResult={decisionResult} returnTo={returnTo} />
      </RequirePermission>
    </div>
  );
}

async function CompanyObject({
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

  let company;
  try {
    company = await getCompany(await getKoalaAccessToken(), id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Şirket detayı"
        permission="company.approve"
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
      <DecisionDeliveryNotice />
      <CompanyReviewBody company={company} returnTo={returnTo} />
    </section>
  );
}
