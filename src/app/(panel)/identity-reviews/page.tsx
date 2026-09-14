import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/panel/page-header";
import {
  ListSearchForm,
  QueueFilters,
  QueueLoadFailure,
  QueuePager,
  SEARCH_PARAM,
  SearchResultSummary,
  activeSearch,
  searchEmptyTitle,
} from "@/components/panel/queue";
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import { identityReviewHref, isUuid, userHref } from "@/lib/panel-href";
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
import {
  SEARCH_QUERY_TOO_LONG_MESSAGE,
  isSearchQueryTooLong,
  readSearchQuery,
} from "@/server/api/search-query";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { IdentityStatusBadge, identityDisplayName } from "./identity-review";

export const metadata: Metadata = { title: "Kimlik incelemeleri" };

/**
 * Kimlik belge kuyruğu. Liste `IdentityReviewDto`; inceleme ve karar
 * `/identity-reviews/[id]` üzerinde. Kapı kuyruğu sarar: `identity.review` yoksa
 * GET hiç çıkmaz.
 */
export default async function IdentityReviewsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kimlik belge kuyruğu"
        description="Yüklenen dört TCKK fotoğrafını (yüz, ön, arka, yüzün altında) inceleyip onaylayın veya gerekçesiyle reddedin. Onay kimlik damgasını çip olmadan koyar ve geri alınamaz. Karar inceleme sayfasındadır."
      />

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
  const query = readSearchQuery(readParam(params, SEARCH_PARAM));
  const search = activeSearch(query);

  const viewState = {
    durum: status,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
    ...(query === null ? {} : { [SEARCH_PARAM]: query }),
  };
  const objectQuery = { ...viewState, sayfa: String(paging.page) };

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
      carry={{ boyut: String(paging.size), ...(query === null ? {} : { [SEARCH_PARAM]: query }) }}
      notice="Durum ve sıralama kuyruğu süzer. TCKK fotoğrafları ve karar inceleme sayfasındadır."
    />
  );

  const searchForm = (error: string | null = null) => (
    <ListSearchForm
      id="kimlik-ara"
      label="Kimlik incelemelerinde ara"
      pathname="/identity-reviews"
      query={query}
      state={viewState}
      placeholder="ör. ayşe yılmaz veya ayse@example.com"
      hint="Profildeki ad-soyad ve e-posta ile belgede beyan edilen ad-soyadta arar; durum süzgeciyle kesişir."
      error={error}
    />
  );

  let page;
  try {
    page = await getIdentityReviews(await getKoalaAccessToken(), { status, paging, query });
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return (
        <div className="flex flex-col gap-4">
          {filters}
          {searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-4">
        {filters}
        {searchForm()}
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
      {searchForm()}
      {decisionResult === null ? null : <DecisionSuccess result={decisionResult} />}
      <SearchResultSummary search={search} total={page.totalElements} unit="inceleme" />

      {reviews.length === 0 ? (
        <EmptyState
          title={
            search === null
              ? `${identityReviewStatusLabel(status)} durumunda inceleme yok.`
              : searchEmptyTitle(search)
          }
          description={
            search === null
              ? "Başka bir durum seçebilir ya da kuyruğu daha sonra yenileyebilirsiniz."
              : `Arama "${identityReviewStatusLabel(status)}" durumuyla kesişir; başka bir durum seçebilir ya da aramayı temizleyebilirsiniz.`
          }
        />
      ) : (
        <Table caption="Kimlik belge kuyruğu">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Ad soyad</TableHeaderCell>
              <TableHeaderCell>Kullanıcı</TableHeaderCell>
              <TableHeaderCell>TCKN</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>Gönderim</TableHeaderCell>
              <TableHeaderCell>Detay</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {reviews.map((review) => (
              <TableRow key={review.id}>
                <TableCell>
                  <Link
                    href={identityReviewHref(review.id, objectQuery)}
                    className="text-brand hover:underline"
                  >
                    {identityDisplayName(review)}
                  </Link>
                </TableCell>
                <TableCell>
                  <UserLink review={review} />
                </TableCell>
                <TableCell>
                  <span className="font-mono text-xs">
                    {review.tcIdentityNumber ?? EMPTY_VALUE}
                  </span>
                </TableCell>
                <TableCell>
                  <IdentityStatusBadge status={review.status} />
                </TableCell>
                <TableCell>{formatDateTime(review.createdAt)}</TableCell>
                <TableCell>
                  <Link
                    href={identityReviewHref(review.id, objectQuery)}
                    className="text-brand hover:underline"
                  >
                    İncele
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <QueuePager window={pageWindow(page)} state={viewState} unit="inceleme" />
    </div>
  );
}

function UserLink({ review }: { review: IdentityReview }) {
  if (review.userId !== null && isUuid(review.userId)) {
    return (
      <Link href={userHref(review.userId)} className="font-mono text-xs text-brand hover:underline">
        {review.userId}
      </Link>
    );
  }
  return <span className="font-mono text-xs">{review.userId ?? EMPTY_VALUE}</span>;
}

function DecisionSuccess({ result }: { result: "approved" | "rejected" }) {
  return (
    <p role="status" className="rounded-md bg-success-soft px-3 py-2 text-sm text-success">
      {result === "approved" ? "Onay" : "Ret"} kararı backend tarafından kaydedildi. Liste yeniden
      yüklendi.
    </p>
  );
}
