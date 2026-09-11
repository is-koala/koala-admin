import Link from "next/link";

import { FormField, SelectInput, TextInput } from "@/components/ui";
import {
  AUDIT_FILTER_NAMES,
  AUDIT_PAGE_PARAM,
  hasActiveFilters,
  type AuditLogFilters,
} from "@/lib/audit-log";
import { formatInteger } from "@/lib/format";

/**
 * The filter bar and the pager — two plain `GET` forms, and no JavaScript in
 * either of them.
 *
 * That is a deliberate choice rather than minimalism for its own sake. A `GET`
 * form's submission *is* a query string on the URL, which the page reads and
 * hands to the backend; there is no state in the browser that could drift from
 * what was actually asked for, and no code path in which a filter is applied to
 * rows that are already on screen. koala-admin#10 is emphatic about this,
 * naming the mistake already made elsewhere in-house: the mobile app fetches
 * `GET /jobs` with no arguments and filters the twenty rows it got back on the
 * device. In an audit log that is worse than slow — you search for March,
 * you are shown the newest page, you find nothing, and you conclude nothing
 * happened.
 *
 * These are Server Components. There is no `"use client"` here and nothing to
 * hydrate: the browser submits the form itself.
 */

export interface AuditLogFilterFormProps {
  filters: AuditLogFilters;
  /** Carried by "Yenile" so a manual refresh stays on the page being read. */
  page: number;
}

export function AuditLogFilterForm({ filters, page }: AuditLogFilterFormProps) {
  const active = hasActiveFilters(filters);

  return (
    <form
      method="get"
      action="/audit-log"
      aria-label="Denetim kaydı filtreleri"
      data-testid="audit-filters"
      className="flex flex-col gap-3 border border-border-subtle bg-surface p-3"
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FormField id="audit-actor" label="Aktör">
          {({ id }) => (
            <TextInput
              id={id}
              name="actor"
              defaultValue={filters.actor ?? ""}
              placeholder="Personel adı ya da id"
            />
          )}
        </FormField>

        <FormField id="audit-action" label="Eylem">
          {({ id }) => (
            <TextInput
              id={id}
              name="action"
              defaultValue={filters.action ?? ""}
              placeholder="job.category.create"
            />
          )}
        </FormField>

        <FormField id="audit-permission" label="İzin">
          {({ id }) => (
            <TextInput
              id={id}
              name="permission"
              defaultValue={filters.permission ?? ""}
              placeholder="category.manage"
            />
          )}
        </FormField>

        <FormField id="audit-allowed" label="Sonuç">
          {({ id }) => (
            <SelectInput id={id} name="allowed" defaultValue={filters.allowed ?? ""}>
              {/* Unset means both, and it is the default: a viewer that hid
                  refusals by default would hide the rows this screen exists
                  for. */}
              <option value="">Hepsi</option>
              <option value="true">İzin verildi</option>
              <option value="false">Reddedildi</option>
            </SelectInput>
          )}
        </FormField>

        <FormField id="audit-resource-type" label="Kaynak tipi">
          {({ id }) => (
            <TextInput
              id={id}
              name="resourceType"
              defaultValue={filters.resourceType ?? ""}
              placeholder="job-category"
            />
          )}
        </FormField>

        <FormField id="audit-resource-id" label="Kaynak id">
          {({ id }) => (
            <TextInput id={id} name="resourceId" defaultValue={filters.resourceId ?? ""} />
          )}
        </FormField>

        <FormField
          id="audit-from"
          label="Başlangıç"
          hint="Gün, Europe/Istanbul. 00:00'dan itibaren."
        >
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              name="from"
              type="date"
              defaultValue={filters.from ?? ""}
              aria-describedby={describedBy}
            />
          )}
        </FormField>

        <FormField id="audit-to" label="Bitiş" hint="Gün dahil, 23:59:59'a kadar.">
          {({ id, describedBy }) => (
            <TextInput
              id={id}
              name="to"
              type="date"
              defaultValue={filters.to ?? ""}
              aria-describedby={describedBy}
            />
          )}
        </FormField>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* No `name`, so submitting drops `page` and a new filter starts at the
            first page rather than at whatever page the previous filter was on. */}
        <button
          type="submit"
          className="rounded-md bg-brand px-3 py-2 text-sm font-medium text-surface hover:bg-brand-strong"
        >
          Filtrele
        </button>

        {/*
         * The only refresh there is.
         *
         * Reading the audit log is an audited read, so a poller would inflate
         * the very table it is polling: every tick would write a row, and after
         * an afternoon with the tab open the log would be mostly a log of
         * itself. Carrying the current page means a refresh shows what changed
         * where the operator is looking, not what changed on page one.
         */}
        <button
          type="submit"
          name={AUDIT_PAGE_PARAM}
          value={String(page)}
          data-testid="audit-refresh"
          className="rounded-md border border-border-strong px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
        >
          Yenile
        </button>

        {active ? (
          <Link
            href="/audit-log"
            data-testid="audit-clear-filters"
            className="text-sm font-medium text-brand hover:underline"
          >
            Filtreleri temizle
          </Link>
        ) : null}

        <span className="ml-auto text-xs text-ink-subtle">
          Filtreler sunucuya gider; sayfa içinde eleme yapılmaz.
        </span>
      </div>
    </form>
  );
}

export interface AuditLogPagerProps {
  filters: AuditLogFilters;
  /** Zero-based, straight from `PageDto`. */
  page: number;
  totalPages: number;
  totalElements: number;
  first: boolean;
  last: boolean;
}

/**
 * Paging is a second `GET` form rather than links, so it carries the active
 * filters as hidden fields and cannot lose them on the way to page two — the
 * classic way a filtered table quietly becomes an unfiltered one.
 */
export function AuditLogPager({
  filters,
  page,
  totalPages,
  totalElements,
  first,
  last,
}: AuditLogPagerProps) {
  return (
    <form
      method="get"
      action="/audit-log"
      aria-label="Denetim kaydı sayfalama"
      data-testid="audit-pager"
      className="flex flex-wrap items-center gap-3"
    >
      {AUDIT_FILTER_NAMES.map((name) =>
        filters[name] === null ? null : (
          <input key={name} type="hidden" name={name} value={filters[name]} />
        ),
      )}

      <button
        type="submit"
        name={AUDIT_PAGE_PARAM}
        value={String(Math.max(0, page - 1))}
        disabled={first}
        className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-subtle"
      >
        Önceki
      </button>

      <span className="text-sm text-ink-muted" data-testid="audit-page-position">
        Sayfa {formatInteger(page + 1)} / {formatInteger(Math.max(1, totalPages))} ·{" "}
        {formatInteger(totalElements)} kayıt
      </span>

      <button
        type="submit"
        name={AUDIT_PAGE_PARAM}
        value={String(page + 1)}
        disabled={last}
        className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken disabled:cursor-not-allowed disabled:text-ink-subtle"
      >
        Sonraki
      </button>
    </form>
  );
}
