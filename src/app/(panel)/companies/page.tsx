import Link from "next/link";
import type { Metadata } from "next";

import { StaffFlagBadges } from "@/components/panel/staff-flag-badges";
import { PageHeader } from "@/components/panel/page-header";
import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
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
import { companyHref, userHrefOrNull } from "@/lib/panel-href";
import {
  COMPANY_APPROVAL_STATUSES,
  COMPANY_PAGING,
  companyApprovalStatusLabel,
  companyTypeLabel,
  getCompanies,
  safeUserDisplayName,
  type CompanyApprovalStatus,
} from "@/server/api/companies";
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
import { loadListFlags } from "@/server/notes/load-flags";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { ApprovalStatusBadge } from "./company-review";

export const metadata: Metadata = { title: "Şirket onayları" };

/**
 * Şirket onay kuyruğu. Liste `AdminCompanyDto`; inceleme ve karar
 * `/companies/[id]` üzerinde. Kapı kuyruğu sarar: `company.approve` yoksa
 * GET hiç çıkmaz.
 */
export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Şirket onay kuyruğu"
        description={
          <>
            Şirket başvurularını ara ve süz. İnceleme, onay ve ret şirket sayfasında. Onay geri
            alınamaz.
          </>
        }
      />

      <RequirePermission permission="company.approve">
        <CompanyQueue params={params} />
      </RequirePermission>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "name,asc", label: "Ada göre (A-Z)" },
  { value: "name,desc", label: "Ada göre (Z-A)" },
];

async function CompanyQueue({ params }: { params: SearchParams }) {
  const status = readEnumParam<CompanyApprovalStatus>(
    params,
    "durum",
    COMPANY_APPROVAL_STATUSES,
    "PENDING",
  );
  const paging = readPaging(params, COMPANY_PAGING);
  const rawQuery = readParam(params, "ara");
  const query = rawQuery?.trim() || null;
  const rawDecisionResult = readParam(params, "sonuc");
  const decisionResult =
    rawDecisionResult === "approved" || rawDecisionResult === "rejected" ? rawDecisionResult : null;

  const viewState = {
    durum: status,
    ...(query === null ? {} : { ara: query }),
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };
  const objectQuery = { ...viewState, sayfa: String(paging.page) };

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "durum",
          label: "Durum",
          value: status,
          options: COMPANY_APPROVAL_STATUSES.map((value) => ({
            value,
            label: companyApprovalStatusLabel(value),
          })),
        },
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{ boyut: String(paging.size), ...(query === null ? {} : { ara: query }) }}
      notice={
        <>
          Durum, arama ve sıralama backend&apos;e gider; gelen sayfa tarayıcıda yeniden süzülmez.
          Arama şirket adı ve vergi numarası üzerinde çalışır. Karar şirket sayfasındadır.
        </>
      }
    />
  );

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getCompanies(accessToken, { status, query, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <CompanySearch query={query} state={viewState} />
        {decisionResult === null ? null : <DecisionSuccess result={decisionResult} />}
        <QueueLoadFailure
          subject="Şirket kuyruğu"
          permission="company.approve"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const companies = page.content;
  const flagsByCompany = await loadListFlags(
    accessToken,
    "COMPANY",
    companies.map((company) => company.id),
  );

  return (
    <div className="flex flex-col gap-6">
      {filters}
      <CompanySearch query={query} state={viewState} />
      {decisionResult === null ? null : <DecisionSuccess result={decisionResult} />}

      {companies.length === 0 ? (
        <EmptyState
          title={
            query === null
              ? `${companyApprovalStatusLabel(status)} durumunda şirket yok.`
              : "Aramayla eşleşen şirket yok."
          }
          description={
            query === null
              ? "Başka bir karar durumu seçebilir ya da kuyruğu daha sonra yenileyebilirsiniz."
              : "Arama şirket adı ve vergi numarası üzerinde sunucuda çalışır."
          }
        />
      ) : (
        <Table caption="Şirket onay kuyruğu">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Şirket</TableHeaderCell>
              <TableHeaderCell>Tür</TableHeaderCell>
              <TableHeaderCell>Vergi no</TableHeaderCell>
              <TableHeaderCell>Oluşturan</TableHeaderCell>
              <TableHeaderCell>Başvuru zamanı</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>Detay</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {companies.map((company) => {
              const creatorHref = userHrefOrNull(company.createdBy?.id);
              return (
                <TableRow key={company.id}>
                  <TableCell>
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={companyHref(company.id, objectQuery)}
                        className="text-brand hover:underline"
                      >
                        {company.name ?? EMPTY_VALUE}
                      </Link>
                      <StaffFlagBadges flags={flagsByCompany.get(company.id) ?? []} />
                    </span>
                  </TableCell>
                  <TableCell>{companyTypeLabel(company.type) ?? EMPTY_VALUE}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{company.taxNumber ?? EMPTY_VALUE}</span>
                  </TableCell>
                  <TableCell>
                    {creatorHref === null ? (
                      (safeUserDisplayName(company.createdBy) ?? EMPTY_VALUE)
                    ) : (
                      <Link href={creatorHref} className="text-brand hover:underline">
                        {safeUserDisplayName(company.createdBy) ?? EMPTY_VALUE}
                      </Link>
                    )}
                  </TableCell>
                  <TableCell>{formatDateTime(company.createdAt)}</TableCell>
                  <TableCell>
                    <ApprovalStatusBadge status={company.approvalStatus} />
                  </TableCell>
                  <TableCell>
                    <Link
                      href={companyHref(company.id, objectQuery)}
                      className="text-brand hover:underline"
                    >
                      İncele
                    </Link>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <QueuePager window={pageWindow(page)} state={viewState} unit="şirket" />
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

function CompanySearch({
  query,
  state,
}: {
  query: string | null;
  state: Readonly<Record<string, string>>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      {Object.entries(state)
        .filter(([name]) => name !== "ara")
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <input type="hidden" name="sayfa" value="0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="sirket-ara" className="text-sm font-medium text-ink">
          Şirket adı ya da vergi numarası ara
        </label>
        <input
          id="sirket-ara"
          name="ara"
          type="search"
          defaultValue={query ?? ""}
          placeholder="ör. Koala Kahve veya 1234567890"
          className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
      >
        Ara
      </button>
    </form>
  );
}
