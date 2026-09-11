import type { Metadata } from "next";

import { PageHeader } from "@/components/panel/page-header";
import {
  DecisionForm,
  QueueFilters,
  QueueLoadFailure,
  QueuePager,
  type DecisionOption,
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
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import {
  COMPANY_DECISION_MAX_NOTE_LENGTH,
  COMPANY_DECISION_MIN_NOTE_LENGTH,
  COMPANY_APPROVAL_STATUSES,
  COMPANY_PAGING,
  companyApprovalStatusLabel,
  companyTypeLabel,
  getCompanies,
  safeUserDisplayName,
  type CompanyApprovalStatus,
  type CompanyReview,
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
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitCompanyDecision } from "./actions";

export const metadata: Metadata = { title: "Şirket onayları" };

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
            Şirket başvurularını ara, kayıtlı adres ve galeri fotoğraflarıyla incele, onayla ya da
            gerekçesiyle reddet. Onay geri alınamaz.
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
  const returnTo = `/companies?${new URLSearchParams({
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
          Arama şirket adı ve vergi numarası üzerinde çalışır.
        </>
      }
    />
  );

  let page;
  try {
    page = await getCompanies(await getKoalaAccessToken(), { status, query, paging });
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

  return (
    <div className="flex flex-col gap-6">
      {filters}
      <CompanySearch query={query} state={viewState} />
      {decisionResult === null ? null : <DecisionSuccess result={decisionResult} />}
      <DecisionDeliveryNotice />

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
        <>
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
              {companies.map((company) => (
                <TableRow key={company.id}>
                  <TableCell>{company.name ?? EMPTY_VALUE}</TableCell>
                  <TableCell>{companyTypeLabel(company.type) ?? EMPTY_VALUE}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{company.taxNumber ?? EMPTY_VALUE}</span>
                  </TableCell>
                  <TableCell>{safeUserDisplayName(company.createdBy) ?? EMPTY_VALUE}</TableCell>
                  <TableCell>{formatDateTime(company.createdAt)}</TableCell>
                  <TableCell>
                    <ApprovalStatusBadge status={company.approvalStatus} />
                  </TableCell>
                  <TableCell>
                    <a href={`#sirket-${company.id}`} className="text-brand hover:underline">
                      İncele
                    </a>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Başvuru detayları ve karar</h2>
            {companies.map((company) => (
              <CompanyDetail key={company.id} company={company} returnTo={returnTo} />
            ))}
          </section>
        </>
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

function ApprovalStatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning";
  return <Badge tone={tone}>{companyApprovalStatusLabel(status)}</Badge>;
}

function CompanyAddress({ address }: { address: CompanyReview["address"] }) {
  if (address === null) {
    return EMPTY_VALUE;
  }

  const locality = [address.districtName, address.cityName, address.countryName]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");

  return (
    <div className="flex flex-col gap-0.5">
      <span>{address.displayAddress ?? EMPTY_VALUE}</span>
      {locality.length > 0 ? <span className="text-ink-muted">{locality}</span> : null}
    </div>
  );
}

function CompanyGallery({ companyId, imageIds }: { companyId: string; imageIds: readonly string[] }) {
  if (imageIds.length === 0) {
    return <span className="text-sm">{EMPTY_VALUE}</span>;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {imageIds.map((imageId, index) => (
        <figure key={imageId} className="flex w-40 flex-col gap-1.5">
          <figcaption className="text-xs font-medium text-ink-muted">Fotoğraf {index + 1}</figcaption>
          {/* eslint-disable-next-line @next/next/no-img-element -- same-origin BFF personel çerezini ister; next/image göndermez. */}
          <img
            src={companyGallerySrc(companyId, imageId)}
            alt={`${index + 1}. galeri fotoğrafı`}
            className="h-40 w-full rounded-lg border border-border-subtle bg-surface-sunken object-cover"
          />
        </figure>
      ))}
    </div>
  );
}

function companyGallerySrc(companyId: string, imageId: string): string {
  return `/api/companies/${encodeURIComponent(companyId)}/images/${encodeURIComponent(imageId)}/download`;
}

function CompanyDetail({ company, returnTo }: { company: CompanyReview; returnTo: string }) {
  const creator = company.createdBy;

  return (
    <details
      id={`sirket-${company.id}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span>{company.name ?? EMPTY_VALUE}</span>
        <ApprovalStatusBadge status={company.approvalStatus} />
        <span className="font-mono text-xs text-ink-subtle">{company.id.slice(0, 8)}</span>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-ink-muted">Şirket kimliği</dt>
          <dd className="font-mono text-sm break-all">{company.id}</dd>

          <dt className="text-sm text-ink-muted">Ticari unvan</dt>
          <dd className="text-sm">{company.name ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Şirket türü</dt>
          <dd className="text-sm">{companyTypeLabel(company.type) ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Vergi numarası</dt>
          <dd className="font-mono text-sm">{company.taxNumber ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">E-posta</dt>
          <dd className="text-sm break-all">{company.email ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Telefon</dt>
          <dd className="text-sm">{company.phoneNumber ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Kayıtlı adres</dt>
          <dd className="text-sm">
            <CompanyAddress address={company.address} />
          </dd>

          <dt className="text-sm text-ink-muted">Galeri</dt>
          <dd>
            <CompanyGallery companyId={company.id} imageIds={company.galleryImageIds} />
          </dd>

          <dt className="text-sm text-ink-muted">Oluşturan</dt>
          <dd className="text-sm">
            {safeUserDisplayName(creator) ?? EMPTY_VALUE}
            {creator?.username ? (
              <span className="text-ink-muted"> · @{creator.username}</span>
            ) : null}
          </dd>

          <dt className="text-sm text-ink-muted">Başvuru zamanı</dt>
          <dd className="text-sm">{formatDateTime(company.createdAt)}</dd>

          <dt className="text-sm text-ink-muted">Karar durumu</dt>
          <dd>
            <ApprovalStatusBadge status={company.approvalStatus} />
          </dd>

          <dt className="text-sm text-ink-muted">Karar zamanı</dt>
          <dd className="text-sm">{formatDateTime(company.approvalDecidedAt)}</dd>

          <dt className="text-sm text-ink-muted">Kaydedilmiş karar gerekçesi</dt>
          <dd className="text-sm whitespace-pre-wrap">{company.approvalNote ?? EMPTY_VALUE}</dd>
        </dl>

        <CompanyDecision company={company} returnTo={returnTo} />
      </div>
    </details>
  );
}

function CompanyDecision({ company, returnTo }: { company: CompanyReview; returnTo: string }) {
  const options: DecisionOption[] = [
    {
      value: "APPROVE",
      label: "Şirketi onayla",
      consequence:
        company.approvalStatus === "REJECTED"
          ? "Şirket APPROVED durumuna geçer; önceki ret gerekçesinin yerini bu onay gerekçesi alır."
          : "Şirket APPROVED durumuna geçer ve karar gerekçesi kaydedilir.",
      irreversible: true,
    },
  ];

  if (company.approvalStatus === "PENDING") {
    options.push({
      value: "REJECT",
      label: "Şirketi reddet",
      consequence:
        "Şirket REJECTED durumuna geçer ve bekleyenler kuyruğundan çıkar; gerekçesi kaydedilir.",
      tone: "danger",
    });
  }

  const canDecide = company.approvalStatus === "PENDING" || company.approvalStatus === "REJECTED";
  const disabledReason =
    company.approvalStatus === "APPROVED"
      ? "Bu şirket onaylı. Backend onayı geri almaya veya onaylı şirketi reddetmeye izin vermez."
      : "Backend bu karar durumundan yeni bir geçiş tanımlamıyor.";

  return (
    <DecisionForm
      action={submitCompanyDecision}
      hiddenFields={{ companyId: company.id, returnTo }}
      options={options}
      legend="Karar"
      noteLabel="Karar gerekçesi"
      noteHint={`${COMPANY_DECISION_MIN_NOTE_LENGTH}-${COMPANY_DECISION_MAX_NOTE_LENGTH} karakter. Gerekçe backend'de karar kaydıyla birlikte saklanır.`}
      submitLabel="Kararı kaydet"
      minNoteLength={COMPANY_DECISION_MIN_NOTE_LENGTH}
      maxNoteLength={COMPANY_DECISION_MAX_NOTE_LENGTH}
      idPrefix={`sirket-${company.id}`}
      disabled={!canDecide}
      disabledReason={disabledReason}
      followUp={<DecisionPersistenceNotice compact />}
    />
  );
}

function DecisionPersistenceNotice({ compact = false }: { compact?: boolean }) {
  return (
    <p className={compact ? undefined : "max-w-prose text-sm text-ink"}>
      Gerekçe şirket kararında saklanır. Backend, varsa şirketin ADMIN yetkilileri için uygulama
      içi, e-posta ve push bildirimlerini göndermeyi dener. Kuyruk yanıtı teslim veya denetim kaydı
      sonucunu taşımadığı için panel bunların tamamlandığını iddia etmez.
    </p>
  );
}

function DecisionDeliveryNotice() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <p className="text-sm font-semibold text-ink">Karar kaydı ve bildirim</p>
      <DecisionPersistenceNotice />
    </div>
  );
}
