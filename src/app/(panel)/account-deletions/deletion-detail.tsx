import Link from "next/link";

import { DecisionForm, type DecisionOption } from "@/components/panel/queue";
import { Badge, type BadgeTone } from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import { userHrefOrNull } from "@/lib/panel-href";
import {
  REJECTION_MAX_REASON_LENGTH,
  REJECTION_MIN_REASON_LENGTH,
  deletionStatusLabel,
  type AccountDeletion,
} from "@/server/api/account-deletions";

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

export function DeletionReviewBody({
  row,
  canReject,
}: {
  row: AccountDeletion;
  canReject: boolean;
}) {
  const open = row.status === "REQUESTED";

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
