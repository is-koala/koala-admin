/**
 * MSW stubs for `GET /admin/audit-log`, shaped to koala-backend#15's contract.
 *
 * The endpoint is not on koala-backend `main` yet, so unlike
 * `test/fixtures/envelopes.ts` these bodies are **not** captured from a running
 * backend — they are written against the contract in koala-admin#10 and
 * koala-backend#15. The envelope around them is captured, though: same
 * `httpStatus: "200 OK"` string, same nanosecond `timeStamp`, same `PageDto`
 * field set.
 *
 * The three rows below are chosen to cover the cases the issue calls out and
 * nothing else: one allowed mutation with a full detail record, one **refused**
 * attempt, and one row whose detail has been erased.
 */

export interface AuditEntryBody {
  id: string;
  occurredAt: string;
  actorStaffId: string | null;
  actorDisplayName: string;
  permission: string;
  action: string;
  resourceType: string;
  resourceId: string;
  allowed: boolean;
  mutating: boolean;
  sensitivity: "NORMAL" | "PERSONAL_DATA" | "FINANCIAL";
  requestBody: unknown;
  ip: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
}

/**
 * The acceptance criterion from koala-admin#10: a category created on the [04]
 * screen shows up here with the actor's name and the permission that allowed
 * it.
 */
export const categoryCreatedEntry: AuditEntryBody = {
  id: "aa000000-0000-4c00-8000-000000000001",
  occurredAt: "2026-09-06T06:20:31.000Z",
  actorStaffId: "b7f4a2c1-0000-4c00-8000-000000000001",
  actorDisplayName: "Katalog Editörü",
  permission: "category.manage",
  action: "job.category.create",
  resourceType: "job-category",
  resourceId: "9a1c0f10-0001-4c00-8000-000000000009",
  allowed: true,
  mutating: true,
  sensitivity: "NORMAL",
  requestBody: { name: "Kurye", code: "COURIER", requiresInsurance: true },
  ip: "10.4.2.19",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
  before: null,
  after: { id: "9a1c0f10-0001-4c00-8000-000000000009", code: "COURIER" },
};

/**
 * The other acceptance criterion: somebody without `category.manage` tried
 * anyway. koala-backend#15 records the refusal, and this row is the only thing
 * that makes the attempt visible to anyone.
 */
export const refusedEntry: AuditEntryBody = {
  id: "aa000000-0000-4c00-8000-000000000002",
  occurredAt: "2026-09-06T06:22:07.000Z",
  actorStaffId: "b7f4a2c1-0000-4c00-8000-000000000002",
  actorDisplayName: "Destek Uzmanı",
  permission: "category.manage",
  action: "job.category.delete",
  resourceType: "job-category",
  resourceId: "9a1c0f10-0001-4c00-8000-000000000005",
  allowed: false,
  mutating: true,
  sensitivity: "NORMAL",
  requestBody: null,
  ip: "10.4.2.31",
  userAgent: "Mozilla/5.0 (X11; Linux x86_64)",
  before: null,
  after: null,
};

/**
 * A row whose detail half is gone — retention expiry or a KVKK erasure. Every
 * detail field is null and every core field is intact, which is exactly the
 * state koala-backend#15 designed for and the one the panel has to narrate
 * rather than render as blanks.
 *
 * Financial on purpose: those are the rows kept for ten years, so the core
 * outliving the detail is the *normal* end state for them rather than an
 * edge case.
 */
export const erasedDetailEntry: AuditEntryBody = {
  id: "aa000000-0000-4c00-8000-000000000003",
  occurredAt: "2026-03-01T11:05:44.000Z",
  actorStaffId: "b7f4a2c1-0000-4c00-8000-000000000003",
  actorDisplayName: "Finans Sorumlusu",
  permission: "payout.release",
  action: "payout.release",
  resourceType: "payout",
  resourceId: "cc000000-0000-4c00-8000-0000000000aa",
  allowed: true,
  mutating: true,
  sensitivity: "FINANCIAL",
  requestBody: null,
  ip: null,
  userAgent: null,
  before: null,
  after: null,
};

export interface AuditPageOptions {
  content?: readonly AuditEntryBody[];
  page?: number;
  size?: number;
  totalElements?: number;
  totalPages?: number;
  first?: boolean;
  last?: boolean;
}

/** A `SuccessDataResult<PageDto<AuditEntryDto>>` body. */
export function auditPageBody(options: AuditPageOptions = {}) {
  const content = options.content ?? [];
  const page = options.page ?? 0;
  const size = options.size ?? 25;
  const totalElements = options.totalElements ?? content.length;
  const totalPages =
    options.totalPages ?? (totalElements === 0 ? 0 : Math.ceil(totalElements / size));

  return {
    success: true,
    message: "Liste getirildi.",
    httpStatus: "200 OK",
    path: "/admin/audit-log",
    requestId: "rid-audit-log",
    timeStamp: "2026-09-06T09:20:00.000000000Z",
    data: {
      content: [...content],
      page,
      size,
      totalElements,
      totalPages,
      first: options.first ?? page === 0,
      last: options.last ?? page >= totalPages - 1,
    },
  };
}
