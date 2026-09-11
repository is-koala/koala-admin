import Link from "next/link";

import { DecisionForm, type DecisionOption } from "@/components/panel/queue";
import { Badge } from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import { userHref } from "@/lib/panel-href";
import {
  COMPANY_DECISION_MAX_NOTE_LENGTH,
  COMPANY_DECISION_MIN_NOTE_LENGTH,
  companyApprovalStatusLabel,
  companyTypeLabel,
  safeUserDisplayName,
  type CompanyReview,
} from "@/server/api/companies";

import { submitCompanyDecision } from "./actions";

export function ApprovalStatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning";
  return <Badge tone={tone}>{companyApprovalStatusLabel(status)}</Badge>;
}

export function CompanyReviewBody({
  company,
  returnTo,
}: {
  company: CompanyReview;
  returnTo: string;
}) {
  const creator = company.createdBy;

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
          ) : (
            <Link href={userHref(creator.id)} className="text-brand hover:underline">
              {safeUserDisplayName(creator) ?? EMPTY_VALUE}
            </Link>
          )}
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
  );
}

export function CompanyDetail({ company, returnTo }: { company: CompanyReview; returnTo: string }) {
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
      <div className="mt-4">
        <CompanyReviewBody company={company} returnTo={returnTo} />
      </div>
    </details>
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
