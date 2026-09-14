import Link from "next/link";

import { DecisionForm, type DecisionOption } from "@/components/panel/queue";
import { StaffRefLink } from "@/components/panel/staff-ref-link";
import { ProfilePicture } from "@/components/panel/profile-picture";
import { Badge } from "@/components/ui";
import { httpUrlOrNull } from "@/lib/external-url";
import { EMPTY_VALUE, formatDateTime, formatInteger } from "@/lib/format";
import { jobsForCompanyHref, userHrefOrNull } from "@/lib/panel-href";
import {
  COMPANY_DECISION_MAX_NOTE_LENGTH,
  COMPANY_DECISION_MIN_NOTE_LENGTH,
  companyApprovalStatusLabel,
  companyContactRoleLabel,
  companyTypeLabel,
  safeUserDisplayName,
  type CompanyContact,
  type CompanyReview,
} from "@/server/api/companies";
import { NO_STAFF_REFS, type StaffRefs } from "@/server/staff/staff-refs";

import { submitCompanyDecision } from "./actions";
import { GalleryPhoto } from "./gallery-photo";

export function ApprovalStatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning";
  return <Badge tone={tone}>{companyApprovalStatusLabel(status)}</Badge>;
}

export function CompanyReviewBody({
  company,
  returnTo,
  canOpenJobs = false,
  staffRefs = NO_STAFF_REFS,
}: {
  company: CompanyReview;
  returnTo: string;
  /** İlan listesi `job.read` ister; izni olmayana bağlantı 403 ekranı olurdu. */
  canOpenJobs?: boolean;
  /** `approvedByStaffId` için çözülmüş adlar (koala-admin#112). */
  staffRefs?: StaffRefs;
}) {
  const creator = company.createdBy;
  const creatorHref = userHrefOrNull(creator?.id);
  const website = httpUrlOrNull(company.website);

  return (
    <div className="flex flex-col gap-4">
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

        <dt className="text-sm text-ink-muted">Web sitesi</dt>
        <dd className="text-sm break-all">
          {company.website === null ? (
            EMPTY_VALUE
          ) : website === null ? (
            company.website
          ) : (
            <a
              href={website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand hover:underline"
            >
              {company.website}
            </a>
          )}
        </dd>

        <dt className="text-sm text-ink-muted">Açıklama</dt>
        <dd className="text-sm whitespace-pre-wrap">{company.description ?? EMPTY_VALUE}</dd>

        <dt className="text-sm text-ink-muted">Logo</dt>
        <dd className="text-sm">
          <ProfilePicture
            url={company.logoUrl}
            name={company.name ?? "Şirket"}
            alt={company.name === null ? "Şirket logosu" : `${company.name} logosu`}
          />
        </dd>

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
          {creator === null ? (
            EMPTY_VALUE
          ) : creatorHref === null ? (
            (safeUserDisplayName(creator) ?? EMPTY_VALUE)
          ) : (
            <Link href={creatorHref} className="text-brand hover:underline">
              {safeUserDisplayName(creator) ?? EMPTY_VALUE}
            </Link>
          )}
          {creator?.username ? (
            <span className="text-ink-muted"> · @{creator.username}</span>
          ) : null}
        </dd>

        {company.companyContacts === null ? null : (
          <>
            <dt className="text-sm text-ink-muted">Yetkililer</dt>
            <dd className="text-sm" data-testid="company-contacts">
              <CompanyContacts contacts={company.companyContacts} />
            </dd>
          </>
        )}

        {company.jobCount === null ? null : (
          <>
            <dt className="text-sm text-ink-muted">İlanlar</dt>
            <dd className="text-sm" data-testid="company-job-count">
              {canOpenJobs ? (
                <Link href={jobsForCompanyHref(company.id)} className="text-brand hover:underline">
                  {formatInteger(company.jobCount)} ilan
                </Link>
              ) : (
                <>
                  {formatInteger(company.jobCount)} ilan{" "}
                  <span className="text-ink-muted">
                    (liste <code className="font-mono">job.read</code> ister)
                  </span>
                </>
              )}
            </dd>
          </>
        )}

        <dt className="text-sm text-ink-muted">Başvuru zamanı</dt>
        <dd className="text-sm">{formatDateTime(company.createdAt)}</dd>

        <dt className="text-sm text-ink-muted">Karar durumu</dt>
        <dd>
          <ApprovalStatusBadge status={company.approvalStatus} />
        </dd>

        <dt className="text-sm text-ink-muted">Karar zamanı</dt>
        <dd className="text-sm">{formatDateTime(company.approvalDecidedAt)}</dd>

        <dt className="text-sm text-ink-muted">Kararı veren personel</dt>
        <dd className="text-sm break-all">
          <StaffRefLink staffId={company.approvedByStaffId} refs={staffRefs} />
        </dd>

        <dt className="text-sm text-ink-muted">Kaydedilmiş karar gerekçesi</dt>
        <dd className="text-sm whitespace-pre-wrap">{company.approvalNote ?? EMPTY_VALUE}</dd>
      </dl>

      <CompanyDecision company={company} returnTo={returnTo} />
    </div>
  );
}

export function DecisionDeliveryNotice() {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <p className="text-sm font-semibold text-ink">Karar kaydı ve bildirim</p>
      <DecisionPersistenceNotice />
    </div>
  );
}

/**
 * Yetkililer `CompanyContactDto`: kullanıcı `SafeUserDto` (e-posta yok) ve
 * şirketteki rolü. Kullanıcı sayfası `user.read` ister; bağlantı
 * `userHrefOrNull` ile, izin kapısı orada.
 */
function CompanyContacts({ contacts }: { contacts: readonly CompanyContact[] }) {
  if (contacts.length === 0) {
    return <span className="text-ink-muted">Bu şirkete bağlı yetkili yok.</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {contacts.map((contact) => {
        const href = userHrefOrNull(contact.user?.id);
        const name = contact.user === null ? null : safeUserDisplayName(contact.user);
        return (
          <li key={contact.id} className="flex flex-wrap items-baseline gap-x-2">
            {contact.user === null ? (
              EMPTY_VALUE
            ) : href === null ? (
              <span>{name ?? contact.user.id}</span>
            ) : (
              <Link href={href} className="text-brand hover:underline">
                {name ?? contact.user.id}
              </Link>
            )}
            <span className="text-ink-muted">{companyContactRoleLabel(contact.role)}</span>
          </li>
        );
      })}
    </ul>
  );
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

function CompanyGallery({
  companyId,
  imageIds,
}: {
  companyId: string;
  imageIds: readonly string[];
}) {
  if (imageIds.length === 0) {
    return <span className="text-sm">{EMPTY_VALUE}</span>;
  }

  return (
    <div className="flex flex-wrap gap-3">
      {imageIds.map((imageId, index) => (
        <figure key={imageId} className="flex w-40 flex-col gap-1.5">
          <figcaption className="text-xs font-medium text-ink-muted">
            Fotoğraf {index + 1}
          </figcaption>
          <GalleryPhoto
            src={companyGallerySrc(companyId, imageId)}
            alt={`${index + 1}. galeri fotoğrafı`}
          />
        </figure>
      ))}
    </div>
  );
}

function companyGallerySrc(companyId: string, imageId: string): string {
  return `/api/companies/${encodeURIComponent(companyId)}/images/${encodeURIComponent(imageId)}/download`;
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
