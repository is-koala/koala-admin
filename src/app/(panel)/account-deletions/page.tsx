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
  type BadgeTone,
} from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import {
  DELETION_PAGING,
  DELETION_STATUS_FILTERS,
  REJECTION_MAX_REASON_LENGTH,
  REJECTION_MIN_REASON_LENGTH,
  deletionStatusLabel,
  getAccountDeletions,
  type DeletionStatus,
  type DeletionStatusFilter,
} from "@/server/api/account-deletions";
import {
  pageWindow,
  readEnumParam,
  readPaging,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { submitDeletionRejection } from "./actions";

export const metadata: Metadata = { title: "Hesap silme talepleri" };

export default async function AccountDeletionsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Hesap silme talepleri"
        description={
          <>
            Kullanıcının açtığı silme talepleri. Liste{" "}
            <code className="font-mono">user.read_pii</code> ister; ret{" "}
            <code className="font-mono">user.deletion.manage</code> ister. Anonimleştirme
            zamanlayıcı işidir — panel onaylamaz, yalnız reddeder.
          </>
        }
      />

      <RequirePermission permission="user.read_pii">
        <DeletionQueue params={params} />
      </RequirePermission>
    </div>
  );
}

const STATUS_TONES: Record<string, BadgeTone> = {
  REQUESTED: "warning",
  ANONYMIZED: "neutral",
  REJECTED: "danger",
};

const SORT_OPTIONS = [
  { value: "requestedAt,desc", label: "En yeni talep önce" },
  { value: "requestedAt,asc", label: "En eski talep önce" },
  { value: "processedAt,desc", label: "İşlenme zamanı (yeni)" },
  { value: "status,asc", label: "Duruma göre" },
];

async function DeletionQueue({ params }: { params: SearchParams }) {
  const filter = readEnumParam<DeletionStatusFilter>(
    params,
    "durum",
    DELETION_STATUS_FILTERS,
    "ALL",
  );
  const status: DeletionStatus | undefined = filter === "ALL" ? undefined : filter;
  const paging = readPaging(params, DELETION_PAGING);
  const canReject = (await getStaffContext()).has("user.deletion.manage");

  const viewState = {
    durum: filter,
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "durum",
          label: "Durum",
          value: filter,
          options: DELETION_STATUS_FILTERS.map((value) => ({
            value,
            label: deletionStatusLabel(value),
          })),
        },
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{ boyut: String(paging.size) }}
      notice="Durum ve sıralama sunucuya gider. Durum seçilmezse backend üç durumu birden döner."
    />
  );

  let page;
  try {
    page = await getAccountDeletions(await getKoalaAccessToken(), { status, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-6">
        {filters}
        <QueueLoadFailure
          subject="Hesap silme kuyruğu"
          permission="user.read_pii"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const rows = page.content;

  return (
    <div className="flex flex-col gap-6">
      {filters}

      {rows.length === 0 ? (
        <EmptyState
          title={
            filter === "ALL"
              ? "Hesap silme talebi yok."
              : `"${deletionStatusLabel(filter)}" durumunda talep yok.`
          }
          description="Kuyruk sunucudaki sayfadır; panel gelen satırları süzmez."
        />
      ) : (
        <>
          <Table caption="Hesap silme kuyruğu">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Talep</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Kullanıcı</TableHeaderCell>
                <TableHeaderCell>İstendi</TableHeaderCell>
                <TableHeaderCell>İşlendi</TableHeaderCell>
                <TableHeaderCell>Not</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    <a href={`#talep-${row.id}`} className="font-mono text-brand hover:underline">
                      {row.id.slice(0, 8)}
                    </a>
                  </TableCell>
                  <TableCell>
                    <Badge tone={STATUS_TONES[row.status] ?? "neutral"}>
                      {deletionStatusLabel(row.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {row.subjectId ?? EMPTY_VALUE}
                  </TableCell>
                  <TableCell>{formatDateTime(row.requestedAt)}</TableCell>
                  <TableCell>{formatDateTime(row.processedAt)}</TableCell>
                  <TableCell className="max-w-72 truncate">
                    {row.blockedReason ?? EMPTY_VALUE}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <QueuePager window={pageWindow(page)} state={viewState} unit="talep" />

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Talep detayı</h2>
            {rows.map((row) => (
              <DeletionDetail key={row.id} row={row} canReject={canReject} />
            ))}
          </section>
        </>
      )}
    </div>
  );
}

const REJECT_OPTION: DecisionOption = {
  value: "REJECT",
  label: "Reddet",
  consequence:
    "Talep reddedilir ve anonimleştirme bu kayıt için durur. Gerekçe kayda geçer. Bu geri alınamaz.",
  irreversible: true,
};

function DeletionDetail({
  row,
  canReject,
}: {
  row: {
    id: string;
    subjectId: string | null;
    status: string;
    requestedAt: string | null;
    processedAt: string | null;
    blockedReason: string | null;
  };
  canReject: boolean;
}) {
  const open = row.status === "REQUESTED";

  return (
    <details
      id={`talep-${row.id}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span className="font-mono text-xs text-ink-subtle">{row.id.slice(0, 8)}</span>
        <Badge tone={STATUS_TONES[row.status] ?? "neutral"}>
          {deletionStatusLabel(row.status)}
        </Badge>
        <span className="text-ink-muted">{formatDateTime(row.requestedAt)}</span>
      </summary>

      <div className="mt-4 flex flex-col gap-4">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-ink-muted">Talep kimliği</dt>
          <dd className="font-mono text-sm break-all">{row.id}</dd>
          <dt className="text-sm text-ink-muted">Kullanıcı</dt>
          <dd className="font-mono text-sm break-all">{row.subjectId ?? EMPTY_VALUE}</dd>
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
            Reddetmek için <code className="font-mono">user.deletion.manage</code> izni gerekir.
            Listeyi görebilmek yetmez.
          </p>
        )}
      </div>
    </details>
  );
}
