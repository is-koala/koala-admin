import { formatInteger } from "@/lib/format";
import type { PageWindow } from "@/server/api/paging";
import { Button } from "@/components/ui";

/**
 * Server-side paging, drawn.
 *
 * The buttons are form submitters carrying `name="sayfa"`, so a click is a new
 * GET with a new `page` parameter and therefore a new Koala request for a
 * different page. Nothing is held in memory between pages and nothing is sliced
 * on arrival — which is the whole claim `PageDto` lets the panel make honestly.
 *
 * `first`/`last` come from the backend rather than being derived from
 * `page === 0`, because they are the backend's own answer about whether another
 * page exists.
 */

export interface QueuePagerProps {
  window: PageWindow;
  /**
   * Every query parameter that describes the *current* view except `sayfa` —
   * the filters and the sort. They ride along as hidden inputs so that paging
   * does not silently reset the filter the operator just chose.
   */
  state: Readonly<Record<string, string>>;
  /** Singular noun for the counted thing, e.g. `"şikayet"`. */
  unit: string;
}

export function QueuePager({ window, state, unit }: QueuePagerProps) {
  const { page, totalPages, totalElements, first, last } = window;
  // `totalPages` is 0 for an empty result; a person reading "sayfa 1 / 0" would
  // reasonably think something is broken.
  const pageCount = Math.max(1, totalPages);

  return (
    <form method="get" className="flex flex-wrap items-center justify-between gap-3">
      {Object.entries(state)
        .filter(([name]) => name !== "sayfa")
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}

      <p className="text-sm text-ink-muted">
        Sayfa {formatInteger(page + 1)} / {formatInteger(pageCount)} · toplam{" "}
        {formatInteger(totalElements)} {unit}
      </p>

      <div className="flex gap-2">
        <Button
          variant="secondary"
          type="submit"
          name="sayfa"
          value={Math.max(0, page - 1)}
          disabled={first}
        >
          Önceki
        </Button>
        <Button variant="secondary" type="submit" name="sayfa" value={page + 1} disabled={last}>
          Sonraki
        </Button>
      </div>
    </form>
  );
}
