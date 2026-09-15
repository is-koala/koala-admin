import type { ReactNode } from "react";

import { Button, SelectInput } from "@/components/ui";

/**
 * The filter bar both queues share — and the reason it is a plain
 * `<form method="get">` rather than anything cleverer.
 *
 * A GET form puts the filter in the URL, the URL is read by the page on the
 * server, and the page turns it into query parameters on the Koala call. There
 * is no step in that chain where a returned page could be filtered in the
 * browser, because there is no browser code. It also means a filtered queue is
 * a link an operator can paste into a ticket, and it works with JavaScript off.
 *
 * One detail worth naming: `sayfa` is submitted as `0`. Changing the filter
 * while staying on page 4 of the *previous* filter is never what anybody meant,
 * and a GET form replaces the whole query string anyway — so the reset is
 * explicit rather than accidental.
 */

export interface QueueFilterOption {
  readonly value: string;
  readonly label: string;
}

export interface QueueFilterSpec {
  /** Query-parameter name, e.g. `durum`. */
  readonly name: string;
  readonly label: string;
  /** Currently selected value, already validated by the page. */
  readonly value: string;
  readonly options: readonly QueueFilterOption[];
}

export interface QueueFiltersProps {
  filters: readonly QueueFilterSpec[];
  /**
   * Query parameters that must survive a filter change — page size, typically.
   * Anything not listed here and not a filter is dropped, which is the correct
   * behaviour for a form that owns the query string.
   */
  carry?: Readonly<Record<string, string>>;
  /**
   * What this queue *cannot* be filtered by, and why. Both queues have gaps
   * (the backend takes one filter each), and an operator hunting for a missing
   * control deserves to be told it does not exist rather than to keep looking.
   */
  notice?: ReactNode;
  submitLabel?: string;
}

export function QueueFilters({
  filters,
  carry = {},
  notice,
  submitLabel = "Uygula",
}: QueueFiltersProps) {
  return (
    <form
      method="get"
      className="flex flex-col gap-3 rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-sm"
    >
      {/* A new filter always starts at the first page. */}
      <input type="hidden" name="sayfa" value="0" />
      {Object.entries(carry).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="flex flex-wrap items-end gap-3">
        {filters.map((filter) => (
          <div key={filter.name} className="flex min-w-44 flex-col gap-1.5">
            <label htmlFor={`filter-${filter.name}`} className="text-xs font-medium text-ink-muted">
              {filter.label}
            </label>
            <SelectInput
              id={`filter-${filter.name}`}
              name={filter.name}
              defaultValue={filter.value}
            >
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </SelectInput>
          </div>
        ))}

        <Button size="sm" type="submit">
          {submitLabel}
        </Button>
      </div>

      {notice ? <p className="max-w-prose text-xs text-ink-muted">{notice}</p> : null}
    </form>
  );
}
