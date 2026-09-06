import { istanbulDayBoundary } from "@/lib/format";
import type { PermissionSensitivity } from "@/server/authz/permissions";

/**
 * The audit log's vocabulary: the row shape, the filter set, and the one
 * function that turns a filter into a query parameter.
 *
 * **Why this is a `lib/` module and not part of `src/server/api/audit.ts`.**
 * Three things need to agree about what a filter is called — the form that
 * collects it, the fetcher that sends it, and the pager that carries it across
 * a page change — and only one of those runs on the server. Splitting the names
 * across three files is how `actor` becomes `actorName` in one of them and a
 * filter silently stops filtering. So the names live here, once, and nothing in
 * this file imports anything that touches the network.
 *
 * **The rule this module exists to enforce.** koala-admin#10 is explicit that
 * filtering happens on the *server*. The panel's sister codebase already made
 * the opposite mistake — the mobile app calls `GET /jobs` with no arguments and
 * filters the twenty rows it gets back on the device — and in an audit log that
 * is not a performance bug, it is a correctness one: you would be searching the
 * most recent page for something that happened in March, find nothing, and
 * conclude nothing happened. There is deliberately no function in this file
 * that takes a list of entries.
 */

/** `sensitivity` on an audit row, mirroring the backend's permission rows. */
export type AuditSensitivity = PermissionSensitivity;

/**
 * One audit row.
 *
 * The split down the middle is koala-backend#15's design, not an accident of
 * serialisation. The **core** half is immutable and kept for 24 months (10
 * years for the financial ones); the **detail** half can be dropped after 6
 * months or on a KVKK erasure request. So the detail fields are nullable and
 * the core fields are not, and a row with a null detail is a complete,
 * intentional record — not a broken one. Anything rendering this type has to
 * say which of the two it is looking at.
 *
 * Declared here rather than inferred from the Zod schema so a Client Component
 * can name it without importing a `server-only` module;
 * `src/server/api/audit.ts` pins its schema to this interface, so the two
 * cannot drift.
 */
export interface AuditEntry {
  readonly id: string;
  /** ISO-8601 instant, UTC. Rendered absolute and in Europe/Istanbul, never relative. */
  readonly occurredAt: string;
  /**
   * Null when the actor has no `staff_members` row, and for the bridge-phase
   * marketplace admin (koala-backend#15). `actorDisplayName` is never null.
   */
  readonly actorStaffId: string | null;
  readonly actorDisplayName: string;
  /** The permission the interceptor checked, e.g. `category.manage`. */
  readonly permission: string;
  /** What was attempted, e.g. `job-category.create`. */
  readonly action: string;
  readonly resourceType: string;
  readonly resourceId: string;
  /**
   * False when the request was refused. koala-backend#15 records refusals too,
   * and these rows are the only thing that makes an attempted privilege
   * escalation visible — which is why they are never filtered out by default.
   */
  readonly allowed: boolean;
  readonly mutating: boolean;
  readonly sensitivity: AuditSensitivity;

  /** Detail half — every one of these is null once the detail row is gone. */
  readonly requestBody: string | null;
  readonly ip: string | null;
  readonly userAgent: string | null;
  readonly before: string | null;
  readonly after: string | null;
}

/** True when this row still has a detail record behind it. */
export function hasDetailRecord(entry: AuditEntry): boolean {
  return (
    entry.requestBody !== null ||
    entry.ip !== null ||
    entry.userAgent !== null ||
    entry.before !== null ||
    entry.after !== null
  );
}

/**
 * The filter names, verbatim from koala-backend#15's query string. These are
 * simultaneously the `name` of every form control and the key of every outgoing
 * query parameter, which is the only arrangement in which the two cannot
 * disagree.
 */
export const AUDIT_FILTER_NAMES = [
  "actor",
  "action",
  "permission",
  "resourceType",
  "resourceId",
  "from",
  "to",
  "allowed",
] as const;

export type AuditFilterName = (typeof AUDIT_FILTER_NAMES)[number];

/** Every filter, with `null` meaning "not applied". */
export type AuditLogFilters = { readonly [K in AuditFilterName]: string | null };

export const AUDIT_PAGE_PARAM = "page";

/**
 * Fixed rather than a control. A page size the operator can raise is a page
 * size somebody sets to 5000 and then scans in the browser — the client-side
 * filtering this module exists to prevent, wearing a different hat.
 */
export const AUDIT_PAGE_SIZE = 25;

export interface AuditLogRequest {
  readonly filters: AuditLogFilters;
  /** Zero-based, like `PageDto`. */
  readonly page: number;
  readonly size: number;
}

export const NO_AUDIT_FILTERS: AuditLogFilters = {
  actor: null,
  action: null,
  permission: null,
  resourceType: null,
  resourceId: null,
  from: null,
  to: null,
  allowed: null,
};

/** What Next.js hands a page as `searchParams`. */
export type SearchParamsInput = Record<string, string | string[] | undefined> | undefined;

function firstValue(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  if (typeof raw !== "string") {
    return null;
  }

  const trimmed = raw.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * `allowed` is a tri-state and the third state is the important one.
 *
 * Unset means "both", and that is the default on purpose: a viewer that
 * defaulted to `allowed=true` would hide every refused attempt, which is the
 * one thing this screen exists to show.
 */
function parseAllowed(value: string | string[] | undefined): string | null {
  const raw = firstValue(value);
  return raw === "true" || raw === "false" ? raw : null;
}

function parseDay(value: string | string[] | undefined): string | null {
  const raw = firstValue(value);
  return raw !== null && /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

function parsePage(value: string | string[] | undefined): number {
  const raw = firstValue(value);
  if (raw === null) {
    return 0;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

/** Read a page's `searchParams` into the request the fetcher takes. */
export function parseAuditLogRequest(params: SearchParamsInput): AuditLogRequest {
  const source = params ?? {};

  return {
    filters: {
      actor: firstValue(source.actor),
      action: firstValue(source.action),
      permission: firstValue(source.permission),
      resourceType: firstValue(source.resourceType),
      resourceId: firstValue(source.resourceId),
      from: parseDay(source.from),
      to: parseDay(source.to),
      allowed: parseAllowed(source.allowed),
    },
    page: parsePage(source[AUDIT_PAGE_PARAM]),
    size: AUDIT_PAGE_SIZE,
  };
}

export function activeFilters(filters: AuditLogFilters): readonly AuditFilterName[] {
  return AUDIT_FILTER_NAMES.filter((name) => filters[name] !== null);
}

export function hasActiveFilters(filters: AuditLogFilters): boolean {
  return activeFilters(filters).length > 0;
}

/**
 * The outgoing query string, and the whole reason this module is testable.
 *
 * `from` and `to` arrive as calendar days and leave as UTC instants covering
 * that day in `Europe/Istanbul` — see `istanbulDayBoundary`. Everything else
 * goes out under its own name, unchanged. `null` values are dropped by
 * `buildKoalaUrl`, so an unset filter is an absent parameter rather than
 * `actor=null`.
 */
export function auditLogQuery(request: AuditLogRequest): Record<string, string | number | null> {
  const { filters } = request;

  return {
    page: request.page,
    size: request.size,
    actor: filters.actor,
    action: filters.action,
    permission: filters.permission,
    resourceType: filters.resourceType,
    resourceId: filters.resourceId,
    allowed: filters.allowed,
    from: filters.from === null ? null : istanbulDayBoundary(filters.from, "start"),
    to: filters.to === null ? null : istanbulDayBoundary(filters.to, "end"),
  };
}
