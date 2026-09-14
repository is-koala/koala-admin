import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";

import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { ObjectTimeline } from "@/components/panel/object-timeline";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { TimelineBuilder, type TimelineEvent } from "@/lib/object-timeline";
import { companiesHref, isUuid } from "@/lib/panel-href";
import {
  companyApprovalStatusLabel,
  getCompany,
  safeUserDisplayName,
  type CompanyReview,
} from "@/server/api/companies";
import { readParam, type SearchParams } from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { SignedDownloadAllowlistNotice } from "@/server/evidence/signed-download-notice";
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
 * çıkmaz. Yetkililer, ilan sayısı, web sitesi ve kararı veren personel
 * koala-backend#283 ile geldi; ilan bağlantısı `job.read` ister (koala-admin#100).
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

  const canOpenJobs = (await getStaffContext()).has("job.read");

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
      <SignedDownloadAllowlistNotice subject="Galeri fotoğrafları" />
      {decisionResult === null ? null : (
        <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
          {decisionResult === "approved" ? "Onay" : "Ret"} kararı backend tarafından kaydedildi.
        </p>
      )}
      <DecisionDeliveryNotice />
      <CompanyReviewBody company={company} returnTo={returnTo} canOpenJobs={canOpenJobs} />
      <ObjectTimeline
        resourceId={company.id}
        subject="Bu şirket"
        events={companyTimelineEvents(company)}
      >
        Başvuru ve kayıtlı karar DTO&apos;dan; onay, ret ve bu şirket kimliğiyle kayıtlı diğer
        personel işlemleri denetim izinden. Galeri görseli kaldırma görsel kimliğiyle yazılır ve
        burada görünmez.
      </ObjectTimeline>
      <ObjectAuditPointer resourceId={company.id} linkLabel="Bu şirketin denetim kayıtlarını aç">
        Onay ve ret backend tarafından bu şirket kimliğiyle denetim kaydına yazılır; personelin bu
        kaydı açması da kayda düşer. Galeri görseli kaldırma görsel kimliğiyle ayrı satırdır.
      </ObjectAuditPointer>
    </section>
  );
}

/**
 * Şirketin DTO'dan türeyen anları (koala-admin#107): başvuru ve kayıtlı
 * karar. Kararı veren personel DTO'da yalnız kimlik; ad çözümü
 * koala-admin#112 ile gelecek, o güne kadar kısa kimlik.
 */
function companyTimelineEvents(company: CompanyReview): readonly TimelineEvent[] {
  const timeline = new TimelineBuilder();
  const creatorName = company.createdBy === null ? null : safeUserDisplayName(company.createdBy);
  timeline.push(company.createdAt, "Başvuru yapıldı", {
    actor:
      company.createdBy === null || creatorName === null
        ? null
        : { kind: "user", userId: company.createdBy.id, name: creatorName },
  });
  timeline.push(
    company.approvalDecidedAt,
    company.approvalStatus === "APPROVED"
      ? "Şirket onaylandı"
      : company.approvalStatus === "REJECTED"
        ? "Şirket reddedildi"
        : `Karar kaydedildi: ${companyApprovalStatusLabel(company.approvalStatus)}`,
    {
      detail: company.approvalNote,
      actor:
        company.approvedByStaffId === null
          ? null
          : { kind: "staff", staffId: company.approvedByStaffId, name: null },
    },
  );
  return timeline.build();
}
