import Link from "next/link";
import type { Metadata } from "next";

import { PageHeader } from "@/components/panel/page-header";
import {
  FilterId,
  FilterNotice,
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
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { objectQueryFor } from "@/lib/breadcrumb";
import { EMPTY_VALUE, formatDateTime, formatInteger, formatWallClock } from "@/lib/format";
import { jobHref, jobsHref, userHrefOrNull } from "@/lib/panel-href";
import {
  JOB_PAGING,
  JOB_STATUSES,
  JOB_STATUS_LABELS,
  getAdminJobs,
  type AdminJob,
  type JobStatus,
} from "@/server/api/jobs";
import {
  pageWindow,
  readPaging,
  readParam,
  readUuidParam,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import {
  SEARCH_QUERY_TOO_LONG_MESSAGE,
  isSearchQueryTooLong,
  readSearchQuery,
} from "@/server/api/search-query";
import { staffPartyName } from "@/server/api/shared/staff-party";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { JOB_STATUS_TONES } from "./labels";

export const metadata: Metadata = { title: "İlanlar" };

/** `?durum=` için "hepsi" değeri; backend'e `status` gitmez. */
const ALL_STATUSES = "ALL";

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "startDateTime,asc", label: "Başlangıca göre" },
  { value: "title,asc", label: "Başlığa göre (A-Z)" },
];

/**
 * İlan listesi (koala-admin#95 / koala-backend#265). `GET /admin/jobs`
 * `job.read` ister; durum süzgeci ve `?ara=` backend'de çalışır, gelen sayfa
 * panelde yeniden süzülmez. Kapı listeyi sarar: izni olmayan kişide GET
 * hiç çıkmaz. Yazma eylemi yok.
 *
 * `?sirket=` bir şirketin ilanlarına süzer (backend `companyId`,
 * koala-backend#283); şirket sayfasındaki ilan sayısı buraya gelir
 * (koala-admin#100). UUID olmayan değer düşer.
 */
export default async function JobsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="İlanlar"
        description={
          <>
            Pazaryerindeki ilanlar; durum süzgeci ve arama backend&apos;de çalışır. Satır ilan
            detayına gider; tam adres orada, yalnız personele görünür.
          </>
        }
      />

      <RequirePermission permission="job.read">
        <JobQueue params={params} />
      </RequirePermission>
    </div>
  );
}

function readStatus(params: SearchParams): JobStatus | null {
  const raw = readParam(params, "durum");
  return raw !== null && (JOB_STATUSES as readonly string[]).includes(raw)
    ? (raw as JobStatus)
    : null;
}

async function JobQueue({ params }: { params: SearchParams }) {
  const status = readStatus(params);
  const paging = readPaging(params, JOB_PAGING);
  const query = readSearchQuery(readParam(params, SEARCH_PARAM));
  const search = activeSearch(query);
  const companyId = readUuidParam(params, "sirket");

  const viewState: Record<string, string> = {
    durum: status ?? ALL_STATUSES,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };
  if (query !== null) viewState[SEARCH_PARAM] = query;
  if (companyId !== null) viewState.sirket = companyId;
  const objectQuery = objectQueryFor(viewState, paging.page);

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "durum",
          label: "Durum",
          value: status ?? ALL_STATUSES,
          options: [
            { value: ALL_STATUSES, label: "Tümü" },
            ...JOB_STATUSES.map((value) => ({ value, label: JOB_STATUS_LABELS[value] })),
          ],
        },
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{
        boyut: String(paging.size),
        ...(query !== null ? { [SEARCH_PARAM]: query } : {}),
        ...(companyId !== null ? { sirket: companyId } : {}),
      }}
      notice={
        companyId === null ? (
          "Durum ve sıralama backend'de uygulanır. Gelen sayfa panelde yeniden süzülmez."
        ) : (
          <FilterNotice
            inline
            testId="job-company-filter"
            clearHref={jobsHref({
              durum: status ?? ALL_STATUSES,
              sirala: sortParam(paging.sort),
              boyut: String(paging.size),
              ...(query !== null ? { [SEARCH_PARAM]: query } : {}),
            })}
          >
            Bu görünüm <FilterId value={companyId} /> şirketinin ilanlarını süzüyor.
          </FilterNotice>
        )
      }
    />
  );

  const searchForm = (error: string | null = null) => (
    <ListSearchForm
      id="ilan-ara"
      label="İlanlarda ara"
      pathname="/jobs"
      query={query}
      state={viewState}
      placeholder="ör. garson, Koala Kafe, ayse@example.com"
      hint="İlan kimliği, ilan başlığı, şirket adı ve işverenin ad-soyadı ile e-postasında arar; durum süzgeciyle kesişir."
      error={error}
    />
  );

  let page;
  try {
    page = await getAdminJobs(await getKoalaAccessToken(), { status, paging, query, companyId });
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
        <QueueLoadFailure
          subject="İlan listesi"
          permission="job.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {filters}
      {searchForm()}
      <SearchResultSummary search={search} total={page.totalElements} unit="ilan" />

      {page.content.length === 0 ? (
        <EmptyState
          title={
            search === null
              ? status === null
                ? "İlan yok."
                : `${JOB_STATUS_LABELS[status]} durumunda ilan yok.`
              : searchEmptyTitle(search)
          }
          description="Durum süzgecini genişletin ya da arama metnini değiştirin."
        />
      ) : (
        <Table caption="İlanlar">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Başlık</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>İşveren</TableHeaderCell>
              <TableHeaderCell>Konum</TableHeaderCell>
              <TableHeaderCell>Başlangıç</TableHeaderCell>
              <TableHeaderCell>Kişi</TableHeaderCell>
              <TableHeaderCell>Başvuru</TableHeaderCell>
              <TableHeaderCell>Atama</TableHeaderCell>
              <TableHeaderCell>Oluşturulma</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {page.content.map((job) => (
              <JobRow key={job.id} job={job} objectQuery={objectQuery} />
            ))}
          </TableBody>
        </Table>
      )}

      {page.totalElements > 0 ? (
        <QueuePager window={pageWindow(page)} state={viewState} unit="ilan" />
      ) : null}
    </div>
  );
}

function JobRow({ job, objectQuery }: { job: AdminJob; objectQuery: Record<string, string> }) {
  const employerHref = job.employer === null ? null : userHrefOrNull(job.employer.id);
  const location = [job.districtName, job.cityName]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" / ");

  return (
    <TableRow>
      <TableCell>
        <Link
          href={jobHref(job.id, objectQuery)}
          className="font-medium text-brand hover:underline"
        >
          {job.title ?? job.id}
        </Link>
      </TableCell>
      <TableCell>
        <Badge tone={JOB_STATUS_TONES[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
      </TableCell>
      <TableCell>
        {employerHref === null ? (
          staffPartyName(job.employer)
        ) : (
          <Link href={employerHref} className="text-brand hover:underline">
            {staffPartyName(job.employer)}
          </Link>
        )}
        {job.companyName === null ? null : (
          <span className="text-ink-muted"> · {job.companyName}</span>
        )}
      </TableCell>
      <TableCell>{location.length === 0 ? EMPTY_VALUE : location}</TableCell>
      <TableCell>{formatWallClock(job.startDateTime)}</TableCell>
      <TableCell>{job.headcount === null ? EMPTY_VALUE : formatInteger(job.headcount)}</TableCell>
      <TableCell>
        {job.applicationCount === null ? EMPTY_VALUE : formatInteger(job.applicationCount)}
      </TableCell>
      <TableCell>
        {job.assignmentCount === null ? EMPTY_VALUE : formatInteger(job.assignmentCount)}
      </TableCell>
      <TableCell>{formatDateTime(job.createdAt)}</TableCell>
    </TableRow>
  );
}
