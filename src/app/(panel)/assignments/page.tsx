import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import {
  ListSearchForm,
  QueueLoadFailure,
  QueuePager,
  SEARCH_PARAM,
  SearchResultSummary,
  activeSearch,
  searchEmptyTitle,
} from "@/components/panel/queue";
import {
  Badge,
  EmptyState,
  FormField,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  TextInput,
} from "@/components/ui";
import {
  EMPTY_VALUE,
  formatCurrency,
  formatDateTime,
  formatInteger,
  formatPercent,
} from "@/lib/format";
import { assignmentHref, assignmentsHref, userHrefOrNull } from "@/lib/panel-href";
import {
  ASSIGNMENT_PAGING,
  getAdminAssignments,
  getEscrowSummary,
  type EscrowSummary,
} from "@/server/api/escrow";
import { pageWindow, readPaging, readParam, type SearchParams } from "@/server/api/paging";
import {
  SEARCH_QUERY_TOO_LONG_MESSAGE,
  isSearchQueryTooLong,
  readSearchQuery,
} from "@/server/api/search-query";
import { safeUserName, type SafeUser } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { ASSIGNMENT_STATUS_LABELS, PAYMENT_STATUS_LABELS, PAYMENT_STATUS_TONES } from "./labels";

export const metadata: Metadata = { title: "Atama özeti" };

/**
 * Atama kuyruğu — koala-backend#203.
 *
 * `GET /admin/job-assignments` `payment.read` ile sayfalar; satır DTO'su
 * UUID bakışıyla aynı `AdminAssignmentDto`. Emanet yazımı burada yok.
 *
 * İki kutu, iki iş: `?atama=` tek bir kaydı UUID ile açar, `?ara=` kuyruğu
 * backend'de süzer (koala-admin#94). Arama kutusu UUID doğrulamaz — atama
 * id'si de aranabilen alanlardan biri, kısmi id yazmak meşru.
 *
 * Satırın "Aç" bağlantısı nesne sayfasına gider (`/assignments/{id}`,
 * koala-admin#95); `?atama=` bakışı kısa özet olarak kaldı ve oradan da
 * nesne sayfasına bağlantı verir.
 *
 * `?isci=` ve `?isveren=` (koala-admin#100) kuyruğu bir kullanıcıya süzer:
 * backend'in `workerId` / `employerId` parametreleri (koala-backend#283).
 * Kullanıcı sayfasındaki sayaçlar buraya gelir. UUID olmayan değer düşer.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function AssignmentsPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Atama özeti"
        description={
          <>
            Son atamaları sayfalar veya kimlikle bir kaydı açın. Para yazımı uyuşmazlık
            kuyruğundadır.
          </>
        }
      />

      <RequirePermission permission="payment.read">
        <AssignmentWorkspace params={params} />
      </RequirePermission>
    </div>
  );
}

async function AssignmentWorkspace({ params }: { params: SearchParams }) {
  const paging = readPaging(params, ASSIGNMENT_PAGING);
  const raw = readParam(params, "atama")?.trim() ?? "";
  const candidate = raw.length === 0 ? null : raw;
  const invalid = candidate !== null && !UUID.test(candidate);
  const query = readSearchQuery(readParam(params, SEARCH_PARAM));
  const search = activeSearch(query);
  const workerId = readUuidParam(params, "isci");
  const employerId = readUuidParam(params, "isveren");
  const partyFilter = {
    ...(workerId === null ? {} : { isci: workerId }),
    ...(employerId === null ? {} : { isveren: employerId }),
  };

  const viewState = {
    boyut: String(paging.size),
    ...(candidate === null ? {} : { atama: candidate }),
    ...(query === null ? {} : { [SEARCH_PARAM]: query }),
    ...partyFilter,
  };

  const form = (
    <LookupForm
      value={candidate ?? ""}
      error={invalid ? "Geçerli bir atama kimliği girin." : null}
      carry={{ ...(query === null ? {} : { [SEARCH_PARAM]: query }), ...partyFilter }}
    />
  );

  const partyNotice =
    workerId === null && employerId === null ? null : (
      <p
        className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink"
        data-testid="assignment-party-filter"
      >
        Bu görünüm{" "}
        {workerId !== null ? (
          <>
            işçisi <span className="font-mono text-xs">{workerId}</span>
          </>
        ) : null}
        {workerId !== null && employerId !== null ? " ve " : null}
        {employerId !== null ? (
          <>
            işvereni <span className="font-mono text-xs">{employerId}</span>
          </>
        ) : null}{" "}
        olan atamaları süzüyor.{" "}
        <Link
          href={assignmentsHref({
            boyut: String(paging.size),
            ...(query === null ? {} : { [SEARCH_PARAM]: query }),
          })}
          className="text-brand hover:underline"
        >
          Süzgeci kaldır
        </Link>
        .
      </p>
    );

  const searchForm = (error: string | null = null) => (
    <ListSearchForm
      id="atama-ara"
      label="Atamalarda ara"
      pathname="/assignments"
      query={query}
      state={viewState}
      placeholder="ör. garson, ayşe@example.com, 9a1c0f10"
      hint="Atama kimliği, ilan başlığı, işveren ve çalışanın ad-soyadı ile e-postasında arar; backend süzer."
      error={error}
    />
  );

  const accessToken = await getKoalaAccessToken();

  let list;
  try {
    list = await getAdminAssignments(accessToken, { paging, query, workerId, employerId });
  } catch (error) {
    if (isSearchQueryTooLong(error)) {
      return (
        <div className="flex flex-col gap-6">
          {form}
          {partyNotice}
          {searchForm(SEARCH_QUERY_TOO_LONG_MESSAGE)}
        </div>
      );
    }
    return (
      <div className="flex flex-col gap-6">
        {form}
        {partyNotice}
        {searchForm()}
        <QueueLoadFailure
          subject="Atama kuyruğu"
          permission="payment.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  let selected: EscrowSummary | null = null;
  let selectedFailure = null;
  if (candidate !== null && !invalid) {
    const onPage = list.content.find((row) => row.id === candidate) ?? null;
    if (onPage !== null) {
      selected = onPage;
    } else {
      try {
        selected = await getEscrowSummary(accessToken, candidate);
      } catch (error) {
        selectedFailure = error;
      }
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {form}
      {partyNotice}
      {searchForm()}

      <section className="flex flex-col gap-3" aria-labelledby="assignment-queue-heading">
        <div className="flex flex-col gap-1">
          <h2 id="assignment-queue-heading" className="text-lg font-semibold">
            Kuyruk
          </h2>
          <p className="max-w-prose text-xs text-ink-muted">
            <code className="font-mono">GET /admin/job-assignments</code> aynı özeti sayfalar.
            Satırdaki tutar DTO&apos;daki <code className="font-mono">pricing</code> alanıdır.
          </p>
        </div>

        <SearchResultSummary search={search} total={list.totalElements} unit="atama" />

        {list.content.length === 0 ? (
          <EmptyState
            title={
              search !== null
                ? searchEmptyTitle(search)
                : partyNotice !== null
                  ? "Bu kullanıcının bu roldeki ataması yok."
                  : "Atama yok."
            }
            description={
              search === null
                ? "Kuyruk boşsa yine de yukarıdan bir atama kimliğiyle bakabilirsiniz."
                : "Arama backend'de atama kimliği, ilan başlığı ve tarafların ad-soyadı ile e-postasında çalışır."
            }
          />
        ) : (
          <Table caption="Atamalar">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Atama zamanı</TableHeaderCell>
                <TableHeaderCell>İş</TableHeaderCell>
                <TableHeaderCell>İşçi</TableHeaderCell>
                <TableHeaderCell>İşveren</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Ödeme</TableHeaderCell>
                <TableHeaderCell>Tutar</TableHeaderCell>
                <TableHeaderCell>Detay</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {list.content.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>{formatDateTime(row.assignmentDateTime)}</TableCell>
                  <TableCell>{row.jobTitle ?? EMPTY_VALUE}</TableCell>
                  <TableCell>{safeUserName(row.worker)}</TableCell>
                  <TableCell>
                    {row.companyName === null
                      ? safeUserName(row.employer)
                      : `${safeUserName(row.employer)} · ${row.companyName}`}
                  </TableCell>
                  <TableCell>
                    <Badge>{ASSIGNMENT_STATUS_LABELS[row.status]}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={PAYMENT_STATUS_TONES[row.paymentStatus]}>
                      {PAYMENT_STATUS_LABELS[row.paymentStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {formatCurrency(row.pricing.employerTotal, row.pricing.currency)}
                  </TableCell>
                  <TableCell>
                    <Link
                      href={assignmentHref(row.id)}
                      className="text-sm font-medium text-brand hover:underline"
                    >
                      Aç
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {list.totalElements > 0 ? (
          <QueuePager window={pageWindow(list)} state={viewState} unit="atama" />
        ) : null}
      </section>

      {selectedFailure !== null ? (
        <QueueLoadFailure
          subject="Atama özeti"
          permission="payment.read"
          failure={classifyQueueFailure(selectedFailure)}
        />
      ) : null}

      {selected === null ? null : <AssignmentSummary summary={selected} />}
    </div>
  );
}

/** Süzgeç kimliği UUID değilse backend'e gitmez: yanlış biçim sessizce düşer, kuyruk süzgeçsiz açılır. */
function readUuidParam(params: SearchParams, key: string): string | null {
  const raw = readParam(params, key)?.trim() ?? "";
  return raw.length > 0 && UUID.test(raw) ? raw : null;
}

function LookupForm({
  value,
  error,
  carry,
}: {
  value: string;
  error: string | null;
  /** Kimlik bakışı aramayı silmesin: `ara` gizli alan olarak taşınır. */
  carry: Readonly<Record<string, string>>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      {Object.entries(carry).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <FormField
        id="atama"
        label="Atama kimliği"
        error={error}
        className="min-w-0 flex-1"
        hint="UUID. Yanlış biçim backend'e gitmez. Boş bırakılırsa kuyruk durur."
      >
        {({ id, describedBy, invalid }) => (
          <TextInput
            id={id}
            name="atama"
            defaultValue={value}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            placeholder="ör. 9a1c0f10-0001-4c00-8000-0000000000aa"
          />
        )}
      </FormField>
      <button
        type="submit"
        className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
      >
        Bak
      </button>
    </form>
  );
}

function AssignmentSummary({ summary }: { summary: EscrowSummary }) {
  return (
    <section className="flex flex-col gap-4" aria-labelledby="assignment-summary-heading">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="assignment-summary-heading" className="text-lg font-semibold">
          Atama
        </h2>
        <Link
          href={assignmentHref(summary.id)}
          className="text-sm font-medium text-brand hover:underline"
        >
          Detayı aç
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <dl className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4 text-sm">
          <Row label="Atama" value={<span className="font-mono text-xs">{summary.id}</span>} />
          <Row label="İş" value={summary.jobTitle ?? EMPTY_VALUE} />
          <Row label="İşçi" value={<NamedUser user={summary.worker} />} />
          <Row
            label="İşveren"
            value={
              summary.companyName === null ? (
                <NamedUser user={summary.employer} />
              ) : (
                <span>
                  <NamedUser user={summary.employer} /> · {summary.companyName}
                </span>
              )
            }
          />
          <Row label="Atama durumu" value={ASSIGNMENT_STATUS_LABELS[summary.status]} />
          <Row
            label="Ödeme durumu"
            value={
              <Badge tone={PAYMENT_STATUS_TONES[summary.paymentStatus]}>
                {PAYMENT_STATUS_LABELS[summary.paymentStatus]}
              </Badge>
            }
          />
          <Row label="Atama zamanı" value={formatDateTime(summary.assignmentDateTime)} />
          <Row label="Tamamlanma" value={formatDateTime(summary.actualCompletionDateTime)} />
        </dl>

        <div className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4">
          <h3 className="text-sm font-semibold">Fiyat dökümü</h3>
          <dl className="flex flex-col gap-2 text-sm">
            <Row
              label="İşçiye ödenecek"
              value={formatCurrency(summary.pricing.workerPayout, summary.pricing.currency)}
            />
            <Row
              label="Komisyon"
              value={`${formatCurrency(
                summary.pricing.serviceFeeAmount,
                summary.pricing.currency,
              )} (${formatPercent(Number(summary.pricing.serviceFeeRate))})`}
            />
            <Row
              label="İşverenden tahsil edilen"
              value={formatCurrency(summary.pricing.employerTotal, summary.pricing.currency)}
            />
            <Row label="Çalışma süresi" value={`${formatInteger(summary.workHours)} sa`} />
          </dl>
        </div>
      </div>
    </section>
  );
}

function NamedUser({ user }: { user: SafeUser }) {
  const href = userHrefOrNull(user.id);
  if (href === null) return safeUserName(user);
  return (
    <Link href={href} className="text-brand hover:underline">
      {safeUserName(user)}
    </Link>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
