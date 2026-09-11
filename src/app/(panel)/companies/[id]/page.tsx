import Link from "next/link";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { getCompany } from "@/server/api/companies";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { CompanyReviewBody, DecisionDeliveryNotice } from "../company-review";

export const metadata: Metadata = { title: "Şirket" };

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Şirket nesne sayfası. Onay ve ret kuyrukla aynı form; GET /admin/companies/{id}.
 * Kapı `company.approve`: izni olmayan kişide GET çıkmaz.
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
            <Link href={"/companies" as Route} className="text-brand hover:underline">
              Kuyruğa dön
            </Link>
          </>
        }
      />

      <RequirePermission permission="company.approve">
        <CompanyObject id={id} decisionResult={decisionResult} />
      </RequirePermission>
    </div>
  );
}

async function CompanyObject({
  id,
  decisionResult,
}: {
  id: string;
  decisionResult: "approved" | "rejected" | null;
}) {
  if (!OBJECT_ID.test(id)) {
    return (
      <p className="text-sm text-ink-muted">Şirket kimliği geçersiz. Kuyruktan bir satır açın.</p>
    );
  }

  let company;
  try {
    company = await getCompany(await getKoalaAccessToken(), id);
  } catch (error) {
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
      <CompanyReviewBody company={company} returnTo={`/companies/${company.id}`} />
    </section>
  );
}
