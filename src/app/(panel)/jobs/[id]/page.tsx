import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { StaffNotesSection } from "@/components/panel/staff-notes";
import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { Badge } from "@/components/ui";
import { httpUrlOrNull } from "@/lib/external-url";
import {
  EMPTY_VALUE,
  formatBoolean,
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatPercent,
  formatWallClock,
} from "@/lib/format";
import { objectBreadcrumb, readQueueState } from "@/lib/breadcrumb";
import { companyHref, isUuid, userHrefOrNull } from "@/lib/panel-href";
import { companyTypeLabel } from "@/server/api/companies";
import {
  JOB_EMPLOYER_TYPE_LABELS,
  JOB_STATUS_LABELS,
  JOB_TYPE_LABELS,
  SALARY_TYPE_LABELS,
  formatJobAddress,
  getAdminJob,
  type AdminJobDetail,
} from "@/server/api/jobs";
import type { SearchParams } from "@/server/api/paging";
import { staffPartyName } from "@/server/api/shared/staff-party";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { JOB_STATUS_TONES } from "../labels";

export const metadata: Metadata = { title: "İlan" };

/**
 * İlan nesne sayfası (koala-admin#95). `GET /admin/jobs/{jobId}`
 * (`AdminJobDetailDto`), `job.read`. Adres tam hâliyle gelir: ADR-0003'ün
 * yaklaşık konum kuralı kullanıcı yüzeyi içindir, personel istisnadır ve
 * backend bunu bilerek böyle döner. Görseller backend'in verdiği adresten
 * çizilir; şikayet sayfasındaki kalıp. Yazma eylemi yok.
 */
export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="İlan"
        breadcrumb={objectBreadcrumb("/jobs", id, readQueueState(query))}
        description="İlanın tamamı: açıklama, kategori, fiyat, işveren ve şirket, tam adres, görseller."
      />

      <RequirePermission permission="job.read">
        <JobObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function JobObject({ id }: { id: string }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const context = await getStaffContext();
  const accessToken = await getKoalaAccessToken();

  let job: AdminJobDetail;
  try {
    job = await getAdminJob(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="İlan detayı"
        permission="job.read"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const employerHref = job.employer === null ? null : userHrefOrNull(job.employer.id);
  const canOpenCompany = context.has("company.approve");
  const address = formatJobAddress(job.address);
  const currency = job.pricing?.currency ?? "TRY";

  return (
    <div className="flex flex-col gap-6">
      <section className="grid gap-4 md:grid-cols-2" aria-labelledby="job-summary-heading">
        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h2 id="job-summary-heading" className="text-sm font-semibold">
            İlan
          </h2>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="Kimlik"
              value={<span className="font-mono text-xs break-all">{job.id}</span>}
            />
            <Row label="Başlık" value={job.title ?? EMPTY_VALUE} />
            <Row
              label="Durum"
              value={
                <Badge tone={JOB_STATUS_TONES[job.status]}>{JOB_STATUS_LABELS[job.status]}</Badge>
              }
            />
            <Row
              label="Kategori"
              value={
                job.category === null
                  ? EMPTY_VALUE
                  : (job.category.name ?? job.category.code ?? EMPTY_VALUE)
              }
            />
            <Row label="Sektör / pozisyon" value={joinOrEmpty([job.sector, job.position], " / ")} />
            <Row
              label="Tür"
              value={joinOrEmpty(
                [
                  job.type === null ? null : JOB_TYPE_LABELS[job.type],
                  job.employerType === null ? null : JOB_EMPLOYER_TYPE_LABELS[job.employerType],
                ],
                " · ",
              )}
            />
            <Row label="Başlangıç" value={formatWallClock(job.startDateTime)} />
            <Row label="Bitiş" value={formatWallClock(job.endDateTime)} />
            <Row label="Kişi sayısı" value={countOrEmpty(job.headcount)} />
            <Row label="Başvuru" value={countOrEmpty(job.applicationCount)} />
            <Row label="Atama" value={countOrEmpty(job.assignmentCount)} />
            <Row label="Oluşturulma" value={formatDateTime(job.createdAt)} />
            <Row label="Güncelleme" value={formatDateTime(job.updatedAt)} />
          </dl>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold">Ücret</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <Row
                label="Ücret"
                value={
                  job.salary === null
                    ? EMPTY_VALUE
                    : `${formatCurrency(job.salary, currency)}${
                        job.salaryType === null ? "" : ` (${SALARY_TYPE_LABELS[job.salaryType]})`
                      }`
                }
              />
              {job.pricing === null ? (
                <Row label="Fiyat dökümü" value="Bu ilan için fiyat dökümü yok." />
              ) : (
                <>
                  <Row
                    label="İşçiye ödenecek"
                    value={formatCurrency(job.pricing.workerPayout, job.pricing.currency)}
                  />
                  <Row
                    label="Komisyon"
                    value={`${formatCurrency(
                      job.pricing.serviceFeeAmount,
                      job.pricing.currency,
                    )} (${formatPercent(Number(job.pricing.serviceFeeRate))})`}
                  />
                  <Row
                    label="İşverenden tahsil edilecek"
                    value={formatCurrency(job.pricing.employerTotal, job.pricing.currency)}
                  />
                </>
              )}
            </dl>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
            <h2 className="text-sm font-semibold">İşveren ve şirket</h2>
            <dl className="flex flex-col gap-2 text-sm">
              <Row
                label="İşveren"
                value={
                  employerHref === null ? (
                    staffPartyName(job.employer)
                  ) : (
                    <Link href={employerHref} className="text-brand hover:underline">
                      {staffPartyName(job.employer)}
                    </Link>
                  )
                }
              />
              <Row label="E-posta" value={job.employer?.email ?? EMPTY_VALUE} />
              <Row
                label="Şirket"
                value={
                  job.company === null ? (
                    (job.companyName ?? EMPTY_VALUE)
                  ) : canOpenCompany ? (
                    <Link href={companyHref(job.company.id)} className="text-brand hover:underline">
                      {job.company.name ?? job.company.id}
                    </Link>
                  ) : (
                    (job.company.name ?? job.company.id)
                  )
                }
              />
              {job.company === null ? null : (
                <>
                  <Row
                    label="Şirket türü"
                    value={companyTypeLabel(job.company.type) ?? EMPTY_VALUE}
                  />
                  <Row label="Şirket e-postası" value={job.company.email ?? EMPTY_VALUE} />
                  <Row label="Telefon" value={job.company.phoneNumber ?? EMPTY_VALUE} />
                  <Row label="Web sitesi" value={<Website url={job.company.website} />} />
                  <Row label="Vergi no" value={job.company.taxNumber ?? EMPTY_VALUE} />
                </>
              )}
            </dl>
          </div>
        </div>
      </section>

      <section
        className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
        aria-labelledby="job-address-heading"
      >
        <h2 id="job-address-heading" className="text-sm font-semibold">
          Tam adres
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Personel yüzeyi tam adresi görür; kullanıcı yüzeyi yalnız yaklaşık konumu. İlan sahibi
          adresi {job.addressPublic === true ? "herkese açık" : "gizli"} olarak işaretlemiş.
        </p>
        {address === null ? (
          <p className="text-sm text-ink-muted">Bu ilanda adres kaydı yok.</p>
        ) : (
          <p className="text-sm" data-testid="job-full-address">
            {address}
          </p>
        )}
        {job.address?.components?.additionalDirections ? (
          <p className="text-sm text-ink-muted">
            Tarif: {job.address.components.additionalDirections}
          </p>
        ) : null}
        {job.address?.needsReview === true ? (
          <Badge tone="warning">Adres doğrulama bekliyor</Badge>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <TextBlock title="Açıklama" text={job.description} empty="Açıklama girilmemiş." />
        <TextBlock title="Görevler" text={job.duties} empty="Görev listesi girilmemiş." />
      </section>

      <section
        className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
        aria-labelledby="job-requirements-heading"
      >
        <h2 id="job-requirements-heading" className="text-sm font-semibold">
          Koşullar
        </h2>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Row
            label="Yaş aralığı"
            value={
              job.minAge === null && job.maxAge === null
                ? EMPTY_VALUE
                : `${job.minAge === null ? "—" : formatInteger(job.minAge)} – ${
                    job.maxAge === null ? "—" : formatInteger(job.maxAge)
                  }`
            }
          />
          <Row label="Kıyafet" value={job.dressCode ?? EMPTY_VALUE} />
          <Row
            label="Sigorta"
            value={formatBoolean(job.insuranceRequired, "Gerekli", "Gerekmiyor")}
          />
          <Row
            label="Deneyim"
            value={formatBoolean(job.experienceRequired, "Gerekli", "Gerekmiyor")}
          />
        </dl>
      </section>

      <Gallery job={job} />

      <StaffNotesSection resourceType="JOB" resourceId={job.id} />

      <ObjectAuditPointer resourceId={job.id} linkLabel="Bu ilanın denetim kayıtlarını aç">
        Panel ilana yazmaz; backend bu ilan kimliğiyle yapılan her personel okumasını ve işlemini
        denetim kaydına düşer.
      </ObjectAuditPointer>
    </div>
  );
}

/**
 * Şirketin beyan ettiği adres; dış bağlantı yeni sekmede ve yönlendiren
 * bilgisi olmadan açılır. `http(s)` dışı bir şema bağlantı olmaz, metin kalır.
 */
function Website({ url }: { url: string | null }) {
  if (url === null || url.trim().length === 0) return <>{EMPTY_VALUE}</>;
  const href = httpUrlOrNull(url);
  if (href === null) return <span className="break-all">{url.trim()}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-brand break-all hover:underline"
    >
      {href}
    </a>
  );
}

function Gallery({ job }: { job: AdminJobDetail }) {
  const images = [...job.images].sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));

  return (
    <section className="flex flex-col gap-3" aria-labelledby="job-gallery-heading">
      <h2 id="job-gallery-heading" className="text-lg font-semibold">
        Görseller
      </h2>
      {images.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu ilana görsel eklenmemiş.</p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {images.map((image) => (
            <li
              key={image.id}
              className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-3"
            >
              {image.url === null ? (
                <p className="text-sm text-ink-muted">Görsel adresi yok.</p>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- backend'in verdiği depo adresi; şikayet sayfasıyla aynı kalıp.
                <img
                  src={image.url}
                  alt={image.caption ?? "İlan görseli"}
                  className="max-h-64 w-full rounded-md border border-border-subtle object-cover"
                />
              )}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
                <span className="font-mono">{image.id}</span>
                {image.cover === true ? <Badge tone="brand">Kapak</Badge> : null}
              </div>
              {image.caption === null ? null : <p className="text-sm">{image.caption}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TextBlock({ title, text, empty }: { title: string; text: string | null; empty: string }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
      <h2 className="text-sm font-semibold">{title}</h2>
      {text === null || text.trim().length === 0 ? (
        <p className="text-sm text-ink-muted">{empty}</p>
      ) : (
        <p className="text-sm whitespace-pre-wrap">{text}</p>
      )}
    </div>
  );
}

function joinOrEmpty(parts: readonly (string | null)[], separator: string): string {
  const present = parts.filter((part): part is string => part !== null && part.length > 0);
  return present.length === 0 ? EMPTY_VALUE : present.join(separator);
}

function countOrEmpty(value: number | null): string {
  return value === null ? EMPTY_VALUE : formatInteger(value);
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
