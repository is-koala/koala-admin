import Link from "next/link";
import type { ReactNode } from "react";

import { StaffRefLink } from "@/components/panel/staff-ref-link";
import { Badge } from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import { isUuid, userHref } from "@/lib/panel-href";
import {
  identityReviewDocumentsComplete,
  identityReviewStatusLabel,
  type IdentityReview,
} from "@/server/api/identity-reviews";
import type { StaffRefs } from "@/server/staff/staff-refs";

import { IdentityReviewDecision } from "./decision-form";
import { DocumentPhoto } from "./document-photo";

export function IdentityStatusBadge({ status }: { status: string }) {
  const tone = status === "APPROVED" ? "success" : status === "REJECTED" ? "danger" : "warning";
  return <Badge tone={tone}>{identityReviewStatusLabel(status)}</Badge>;
}

export function identityDisplayName(review: IdentityReview): string {
  const name = [review.firstName, review.lastName].filter(Boolean).join(" ").trim();
  return name.length > 0 ? name : EMPTY_VALUE;
}

export function IdentityReviewBody({
  review,
  returnTo,
  staffRefs,
}: {
  review: IdentityReview;
  returnTo: string;
  /** `reviewedByStaffId` için ad ve `/staff` bağlantısı (koala-admin#112). */
  staffRefs: StaffRefs;
}) {
  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <Row label="İnceleme" value={<span className="font-mono text-xs">{review.id}</span>} />
        <Row
          label="Kullanıcı"
          value={
            review.userId !== null && isUuid(review.userId) ? (
              <Link
                href={userHref(review.userId)}
                className="font-mono text-xs text-brand hover:underline"
              >
                {review.userId}
              </Link>
            ) : (
              <span className="font-mono text-xs">{review.userId ?? EMPTY_VALUE}</span>
            )
          }
        />
        <Row label="Ad soyad" value={identityDisplayName(review)} />
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
        <Row label="Gönderim" value={formatDateTime(review.createdAt)} />
        <Row label="Ret gerekçesi" value={review.rejectionReason ?? EMPTY_VALUE} />
        <Row label="Onay zamanı" value={formatDateTime(review.verifiedAt)} />
        <Row label="Ret zamanı" value={formatDateTime(review.rejectedAt)} />
        <Row
          label="Kararı veren personel"
          value={<StaffRefLink staffId={review.reviewedByStaffId} refs={staffRefs} />}
        />
      </dl>

      <section className="flex flex-col gap-3" aria-labelledby={`tckk-${review.id}`}>
        <h3 id={`tckk-${review.id}`} className="text-sm font-semibold text-ink">
          TCKK fotoğrafları
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <DocumentPhoto
            reviewId={review.id}
            documentId={review.selfieDocumentId}
            label="Yüz"
            emptyLabel="Yüz fotoğrafı yok"
            alt="Yüz fotoğrafı"
          />
          <DocumentPhoto
            reviewId={review.id}
            documentId={review.frontDocumentId}
            label="TCKK ön"
            emptyLabel="TCKK ön fotoğrafı yok"
            alt="TCKK ön yüz"
          />
          <DocumentPhoto
            reviewId={review.id}
            documentId={review.backDocumentId}
            label="TCKK arka"
            emptyLabel="TCKK arka fotoğrafı yok"
            alt="TCKK arka yüz"
          />
          <DocumentPhoto
            reviewId={review.id}
            documentId={review.togetherDocumentId}
            label="TCKK yüzün altında"
            emptyLabel="TCKK yüzün altında fotoğrafı yok"
            alt="TCKK yüzün altında"
          />
        </div>
      </section>

      {review.status === "PENDING" ? (
        <IdentityReviewDecision
          reviewId={review.id}
          returnTo={returnTo}
          canApprove={identityReviewDocumentsComplete(review)}
        />
      ) : (
        <p className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
          Bu inceleme sonuçlanmış. Backend ikinci bir kararı kabul etmez.
        </p>
      )}
    </div>
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
