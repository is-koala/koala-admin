import type { Metadata } from "next";
import type { ReactNode } from "react";

import { IdentityReviewDecision } from "@/app/(panel)/identity-reviews/decision-form";
import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import {
  IDENTITY_REVIEW_PAGING,
  IDENTITY_REVIEW_STATUSES,
  getIdentityReviews,
  identityReviewStatusLabel,
  type IdentityReview,
  type IdentityReviewStatus,
} from "@/server/api/identity-reviews";
import {
  pageWindow,
  readEnumParam,
  readPaging,
  readParam,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

export const metadata: Metadata = { title: "Kimlik incelemeleri" };

export default async function IdentityReviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Kimlik belge kuyruğu</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Kullanıcının yüklediği TCKK ön ve arka fotoğraflarını inceleyip onaylayın veya
          gerekçesiyle reddedin. Onay <code className="font-mono">identityVerified</code> damgasını
          çip olmadan koyar. İzin <code className="font-mono">identity.review</code> hem panelde hem
          backend&apos;de yeniden denetlenir.
        </p>
      </header>

      <RequirePermission permission="identity.review">
        <IdentityQueue params={params} />
      </RequirePermission>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
];

async function IdentityQueue({ params }: { params: SearchParams }) {
  const status = readEnumParam<IdentityReviewStatus>(
    params,
    "durum",
    IDENTITY_REVIEW_STATUSES,
    "PENDING",
  );
  const paging = readPaging(params, IDENTITY_REVIEW_PAGING);
  const rawDecisionResult = readParam(params, "sonuc");
  const decisionResult =
    rawDecisionResult === "approved" || rawDecisionResult === "rejected" ? rawDecisionResult : null;

  const viewState = {
    durum: status,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };
  const returnTo = `/identity-reviews?${new URLSearchParams({
    ...viewState,
    sayfa: String(paging.page),
  }).toString()}`;

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "durum",
          label: "Durum",
          value: status,
          options: IDENTITY_REVIEW_STATUSES.map((value) => ({
            value,
            label: identityReviewStatusLabel(value),
          })),
        },
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{ boyut: String(paging.size) }}
      notice={
        <>
          Durum ve sıralama backend&apos;e gider. Fotoğraflar bu dilimde yalnız belge kimliği olarak
          görünür; imzalı indirme sonraki dilimdedir.
        </>
      }
    />
  );

  let page;
  try {
    page = await getIdentityReviews(await getKoalaAccessToken(), { status, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        {decisionResult === null ? null : <DecisionSuccess result={decisionResult} />}
        <QueueLoadFailure
          subject="Kimlik kuyruğu"
          permission="identity.review"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const reviews = page.content;

  return (
    <div className="flex flex-col gap-6">
      {filters}
      {decisionResult === null ? null : <DecisionSuccess result={decisionResult} />}

      {reviews.length === 0 ? (
        <EmptyState
          title={`${identityReviewStatusLabel(status)} durumunda inceleme yok.`}
          description="Başka bir durum seçebilir ya da kuyruğu daha sonra yenileyebilirsiniz."
        />
      ) : (
        <>
          <Table caption="Kimlik belge kuyruğu">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Ad soyad</TableHeaderCell>
                <TableHeaderCell>TCKN</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Gönderim</TableHeaderCell>
                <TableHeaderCell>Detay</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {reviews.map((review) => (
                <TableRow key={review.id}>
                  <TableCell>{displayName(review)}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">
                      {review.tcIdentityNumber ?? EMPTY_VALUE}
                    </span>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={review.status} />
                  </TableCell>
                  <TableCell>{formatDateTime(review.createdAt)}</TableCell>
                  <TableCell>
                    <a href={`#inceleme-${review.id}`} className="text-brand hover:underline">
                      İncele
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">İnceleme detayı ve karar</h2>
            {reviews.map((review) => (
              <ReviewDetail key={review.id} review={review} returnTo={returnTo} />
            ))}
          </section>
        </>
      )}

      <QueuePager window={pageWindow(page)} state={viewState} unit="inceleme" />
    </div>
  );
}

function DecisionSuccess({ result }: { result: "approved" | "rejected" }) {
  return (
    <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
      {result === "approved" ? "Onay" : "Ret"} kararı backend tarafından kaydedildi. Liste yeniden
      yüklendi.
    </p>
  );
}

function StatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning";
  return <Badge tone={tone}>{identityReviewStatusLabel(status)}</Badge>;
}

function displayName(review: IdentityReview): string {
  const name = [review.firstName, review.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : EMPTY_VALUE;
}

function ReviewDetail({ review, returnTo }: { review: IdentityReview; returnTo: string }) {
  return (
    <details
      id={`inceleme-${review.id}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span>{displayName(review)}</span>
        <StatusBadge status={review.status} />
        <span className="font-mono text-xs text-ink-subtle">{review.id.slice(0, 8)}</span>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <Row label="İnceleme" value={<span className="font-mono text-xs">{review.id}</span>} />
          <Row
            label="Kullanıcı"
            value={<span className="font-mono text-xs">{review.userId ?? EMPTY_VALUE}</span>}
          />
          <Row label="Ad soyad" value={displayName(review)} />
          <Row
            label="TCKN"
            value={
              <span className="font-mono text-sm">{review.tcIdentityNumber ?? EMPTY_VALUE}</span>
            }
          />
          <Row
            label="Belge no"
            value={
              <span className="font-mono text-sm">{review.tcDocumentNumber ?? EMPTY_VALUE}</span>
            }
          />
          <Row label="Doğum tarihi" value={review.birthDate ?? EMPTY_VALUE} />
          <Row
            label="Ön yüz belgesi"
            value={
              <span className="font-mono text-xs">{review.frontDocumentId ?? EMPTY_VALUE}</span>
            }
          />
          <Row
            label="Arka yüz belgesi"
            value={
              <span className="font-mono text-xs">{review.backDocumentId ?? EMPTY_VALUE}</span>
            }
          />
          <Row label="Gönderim" value={formatDateTime(review.createdAt)} />
          <Row label="Ret gerekçesi" value={review.rejectionReason ?? EMPTY_VALUE} />
        </dl>

        {review.status === "PENDING" ? (
          <IdentityReviewDecision reviewId={review.id} returnTo={returnTo} />
        ) : (
          <p className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
            Bu inceleme sonuçlanmış. Backend ikinci bir kararı kabul etmez.
          </p>
        )}
      </div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <>
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-sm text-ink">{value}</dd>
    </>
  );
}
