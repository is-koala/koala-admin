import Link from "next/link";

import { DecisionForm, type DecisionOption } from "@/components/panel/queue";
import { StaffRefLink } from "@/components/panel/staff-ref-link";
import { Badge, type BadgeTone } from "@/components/ui";
import type { Route } from "next";

import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import { assignmentHref, disputeHref, paymentHref, userHrefOrNull } from "@/lib/panel-href";
import {
  REJECTION_MAX_REASON_LENGTH,
  REJECTION_MIN_REASON_LENGTH,
  deletionBlockerLabel,
  deletionStatusLabel,
  type AccountDeletion,
  type DeletionBlocker,
} from "@/server/api/account-deletions";
import type { Permission } from "@/server/authz/permissions";
import type { StaffRefs } from "@/server/staff/staff-refs";

import { submitDeletionRejection } from "./actions";

export const DELETION_STATUS_TONES: Record<string, BadgeTone> = {
  REQUESTED: "warning",
  ANONYMIZED: "neutral",
  REJECTED: "danger",
};

export function DeletionStatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={DELETION_STATUS_TONES[status] ?? "neutral"}>{deletionStatusLabel(status)}</Badge>
  );
}

export function DeletionSubjectLink({ subjectId }: { subjectId: string | null }) {
  const href = userHrefOrNull(subjectId);
  if (subjectId === null) return EMPTY_VALUE;
  if (href === null) return subjectId;
  return (
    <Link href={href} className="text-brand hover:underline">
      {subjectId}
    </Link>
  );
}

const REJECT_OPTION: DecisionOption = {
  value: "REJECT",
  label: "Reddet",
  consequence:
    "Talep reddedilir ve anonimleştirme bu kayıt için durur. Gerekçe kayda geçer. Bu geri alınamaz.",
  irreversible: true,
};

/**
 * Engelleyicinin kimliği türe göre başka kayda gider (`LegalManager.collectBlockers`
 * → `PartyLink.id`): bekleyen tahsilat ödeme denemesi, emanet ve devam eden iş
 * atama, uyuşmazlık uyuşmazlık. Bağlantı yalnız hedef sayfanın izni varken;
 * kimlik her zaman mono yazılır. Liste canlı hesaplanır ve yalnız REQUESTED
 * talepte gelir; boş liste "anonimleştirmeyi bekleyen bir şey yok" demektir.
 */
function blockerHref(blocker: DeletionBlocker, held: ReadonlySet<Permission>): Route | null {
  if (blocker.id === null) return null;
  switch (blocker.type) {
    case "PENDING_PAYMENT":
      return held.has("payment.read") ? paymentHref(blocker.id) : null;
    case "ESCROW":
    case "ACTIVE_WORK":
      return held.has("payment.read") ? assignmentHref(blocker.id) : null;
    case "DISPUTE":
      return held.has("dispute.resolve") ? disputeHref(blocker.id) : null;
    default:
      return null;
  }
}

function Blockers({
  blockers,
  held,
}: {
  blockers: readonly DeletionBlocker[];
  held: ReadonlySet<Permission>;
}) {
  if (blockers.length === 0) {
    return <span className="text-ink-muted">Engelleyici yok; zamanlayıcı anonimleştirebilir.</span>;
  }
  return (
    <ul className="flex flex-col gap-1">
      {blockers.map((blocker, index) => {
        const href = blockerHref(blocker, held);
        return (
          <li
            key={`${blocker.type}-${blocker.id ?? index}`}
            className="flex flex-wrap items-baseline gap-x-2"
          >
            <Badge tone="warning">{deletionBlockerLabel(blocker.type)}</Badge>
            {blocker.id === null ? null : href === null ? (
              <span className="font-mono text-xs break-all">{blocker.id}</span>
            ) : (
              <Link href={href} className="font-mono text-xs text-brand hover:underline">
                {blocker.id}
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export function DeletionReviewBody({
  row,
  canReject,
  permissions = [],
  staffRefs,
}: {
  row: AccountDeletion;
  canReject: boolean;
  /** Engelleyici bağlantıları: ödeme/atama `payment.read`, uyuşmazlık `dispute.resolve`. */
  permissions?: readonly Permission[];
  /** `rejectedByStaffId` için çözülmüş adlar (koala-admin#112). */
  staffRefs: StaffRefs;
}) {
  const open = row.status === "REQUESTED";
  const held = new Set(permissions);

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-ink-muted">Talep kimliği</dt>
        <dd className="font-mono text-sm break-all">{row.id}</dd>
        <dt className="text-sm text-ink-muted">Kullanıcı</dt>
        <dd className="font-mono text-sm break-all">
          <DeletionSubjectLink subjectId={row.subjectId} />
        </dd>
        <dt className="text-sm text-ink-muted">İstendi</dt>
        <dd className="text-sm">{formatDateTime(row.requestedAt)}</dd>
        <dt className="text-sm text-ink-muted">İşlendi</dt>
        <dd className="text-sm">{formatDateTime(row.processedAt)}</dd>
        <dt className="text-sm text-ink-muted">Not</dt>
        <dd className="text-sm whitespace-pre-wrap">{row.blockedReason ?? EMPTY_VALUE}</dd>
        {row.status === "REJECTED" || row.rejectionReason !== null ? (
          <>
            <dt className="text-sm text-ink-muted">Ret gerekçesi</dt>
            <dd className="text-sm whitespace-pre-wrap" data-testid="deletion-rejection-reason">
              {row.rejectionReason ?? EMPTY_VALUE}
            </dd>
            <dt className="text-sm text-ink-muted">Reddeden personel</dt>
            <dd className="text-sm break-all">
              <StaffRefLink staffId={row.rejectedByStaffId} refs={staffRefs} />
            </dd>
          </>
        ) : null}
        {row.blockers === null ? null : (
          <>
            <dt className="text-sm text-ink-muted">Engelleyiciler</dt>
            <dd className="text-sm" data-testid="deletion-blockers">
              <Blockers blockers={row.blockers} held={held} />
            </dd>
          </>
        )}
      </dl>

      {canReject ? (
        <DecisionForm
          action={submitDeletionRejection}
          hiddenFields={{ requestId: row.id }}
          options={[REJECT_OPTION]}
          legend="Ret"
          noteLabel="Ret gerekçesi"
          noteHint={`En az ${REJECTION_MIN_REASON_LENGTH}, en fazla ${REJECTION_MAX_REASON_LENGTH} karakter. Backend gerekçeyi zorunlu tutar.`}
          submitLabel="Talebi reddet"
          minNoteLength={REJECTION_MIN_REASON_LENGTH}
          maxNoteLength={REJECTION_MAX_REASON_LENGTH}
          idPrefix={`talep-${row.id}`}
          disabled={!open}
          disabledReason={
            open
              ? undefined
              : `Bu talep "${deletionStatusLabel(row.status)}" — backend işlenmiş bir talebi tekrar reddetmiyor (409).`
          }
        />
      ) : (
        <p className="text-sm text-ink-muted">
          Bu talebi reddetmek için silme yönetimi yetkisi gerekir. Listeyi görebilmek yetmez.
        </p>
      )}
    </div>
  );
}
