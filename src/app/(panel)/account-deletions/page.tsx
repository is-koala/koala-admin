import type { Metadata } from "next";
import Link from "next/link";

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
import { accountDeletionHref } from "@/lib/panel-href";
import {
  DELETION_PAGING,
  DELETION_STATUS_FILTERS,
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
import { classifyQueueFailure } from "@/server/queue/decisions";

import { DeletionStatusBadge, DeletionSubjectLink } from "./deletion-detail";

export const metadata: Metadata = { title: "Hesap silme talepleri" };

/**
 * Hesap silme kuyruğu. Liste `AccountDeletionDto`; detay ve ret
 * `/account-deletions/[id]` üzerinde. Kapı `user.read_pii`: yoksa GET çıkmaz.
 * Ret ayrı kapı: `user.deletion.manage`.
 */
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
            Kullanıcının açtığı silme talepleri. Anonimleştirme zamanlayıcı işidir — panel
            onaylamaz, yalnız reddeder. Ret talep sayfasındadır.
          </>
        }
      />

      <RequirePermission permission="user.read_pii">
        <DeletionQueue params={params} />
      </RequirePermission>
    </div>
  );
}

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

  const viewState = {
    durum: filter,
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
      notice="Durum ve sıralama sunucuya gider. Durum seçilmezse backend üç durumu birden döner. Ret talep sayfasındadır."
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
        <Table caption="Hesap silme kuyruğu">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Talep</TableHeaderCell>
              <TableHeaderCell>Durum</TableHeaderCell>
              <TableHeaderCell>Kullanıcı</TableHeaderCell>
              <TableHeaderCell>İstendi</TableHeaderCell>
              <TableHeaderCell>İşlendi</TableHeaderCell>
              <TableHeaderCell>Not</TableHeaderCell>
              <TableHeaderCell>Detay</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Link
                    href={accountDeletionHref(row.id, objectQuery)}
                    className="font-mono text-brand hover:underline"
                  >
                    {row.id.slice(0, 8)}
                  </Link>
                </TableCell>
                <TableCell>
                  <DeletionStatusBadge status={row.status} />
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <DeletionSubjectLink subjectId={row.subjectId} />
                </TableCell>
                <TableCell>{formatDateTime(row.requestedAt)}</TableCell>
                <TableCell>{formatDateTime(row.processedAt)}</TableCell>
                <TableCell className="max-w-72 truncate">
                  {row.blockedReason ?? EMPTY_VALUE}
                </TableCell>
                <TableCell>
                  <Link
                    href={accountDeletionHref(row.id, objectQuery)}
                    className="text-brand hover:underline"
                  >
                    İncele
                  </Link>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <QueuePager window={pageWindow(page)} state={viewState} unit="talep" />
    </div>
  );
}
