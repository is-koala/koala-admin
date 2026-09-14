import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import { searchQueryParam } from "./search-query";
import type { PageDto } from "./types";
import { safeUserName, safeUserSchema } from "./users";

/**
 * The report queue's contract with `webAPI/ReportsController.java`.
 *
 * ```java
 * GET  /admin/reports?status=&reason=&targetType=&reportedUserId=&reporterId=
 * GET  /admin/reports/{id}
 * POST /admin/reports/{id}/review
 * ```
 *
 * List rows are `AdminReportDto`: reporter, reported user, prior-count, no
 * content preview. The preview (job title, message body, image URL) lives on
 * the detail endpoint so a bookmarked `?id=` does not depend on which page the
 * row happened to sit on.
 */

export const REPORTS_PATH = "/admin/reports";

/** `entities/ReportStatus.java`, in the order the enum declares them. */
export const REPORT_STATUSES = ["OPEN", "UNDER_REVIEW", "ACTIONED", "DISMISSED"] as const;

export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** `entities/ReportReason.java`. */
export const REPORT_REASONS = [
  "SPAM",
  "HARASSMENT",
  "FRAUD",
  "OFF_PLATFORM_PAYMENT",
  "INAPPROPRIATE_CONTENT",
  "FAKE_PROFILE",
  "NO_SHOW",
  "OTHER",
] as const;

const STATUS_LABELS: Record<string, string> = {
  OPEN: "Açık",
  UNDER_REVIEW: "İncelemede",
  ACTIONED: "Haklı bulundu",
  DISMISSED: "Reddedildi",
};

const REASON_LABELS: Record<string, string> = {
  SPAM: "Spam",
  HARASSMENT: "Taciz",
  FRAUD: "Dolandırıcılık",
  OFF_PLATFORM_PAYMENT: "Platform dışı ödeme",
  INAPPROPRIATE_CONTENT: "Uygunsuz içerik",
  FAKE_PROFILE: "Sahte profil",
  NO_SHOW: "Randevuya gelmedi",
  OTHER: "Diğer",
};

/**
 * Labels fall back to the raw code rather than to an empty cell.
 *
 * The same reasoning as `partitionPermissions`: the backend can add a
 * `ReportReason` before the panel knows about it, and an operator seeing
 * `IMPERSONATION` in a table can still act on it. An operator seeing a blank
 * cell cannot.
 */
export function reportStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

export function reportReasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason;
}

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const nullableUser = safeUserSchema.nullish().transform((value) => value ?? null);

/**
 * `core/dtos/report/response/AdminReportDto.java`.
 *
 * `reason` and `status` are `z.string()` rather than `z.enum(...)` on purpose.
 * A backend that ships a new enum member first would otherwise fail the whole
 * page's schema check, and an empty moderation queue that is *actually* full is
 * exactly the failure this screen exists to prevent. The filter still only ever
 * sends a value from {@link REPORT_STATUSES}, which is the direction that has
 * to be strict — Spring answers an unknown enum with 400.
 *
 * Reporter and reported user are `SafeUserDto`: name and username, never email
 * or phone. `reportedUserReportCount` is the table-wide total for that user,
 * including closed reports — not the count on the current page.
 */
export const reportSchema = z.object({
  id: z.string(),
  reporter: nullableUser,
  reportedUser: nullableUser,
  reportedUserId: nullableString,
  jobId: nullableString,
  /** koala-backend#283: şikayetin bağlı olduğu atama; `payment.read` ile açılır. */
  jobAssignmentId: nullableString,
  messageId: nullableString,
  imageId: nullableString,
  reason: z.string(),
  description: nullableString,
  status: z.string(),
  reviewedBy: nullableUser,
  /** koala-backend#283: kararı veren personelin kimliği. */
  reviewedByStaffId: nullableString,
  reviewNote: nullableString,
  reviewedAt: nullableString,
  createdAt: nullableString,
  reportedUserReportCount: z.number().int().nonnegative().default(0),
});

export type Report = z.infer<typeof reportSchema>;

export function reportPartyName(user: Report["reporter"]): string {
  return safeUserName(user);
}

const reportContentSchema = z.object({
  jobTitle: nullableString,
  messageBody: nullableString,
  imageUrl: nullableString,
});

export const reportDetailSchema = z.object({
  report: reportSchema,
  content: reportContentSchema,
});

export type ReportContent = z.infer<typeof reportContentSchema>;
export type ReportDetail = z.infer<typeof reportDetailSchema>;

/** `ReportManager.SORTABLE` and `ReportManager.DEFAULT_SORT`, copied. */
export const REPORT_PAGING: PagingContract = {
  sortable: ["createdAt", "status"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

export type ReportTargetKind = "USER" | "JOB" | "MESSAGE" | "IMAGE";

export interface ReportTarget {
  readonly kind: ReportTargetKind;
  readonly id: string;
}

const TARGET_LABELS: Record<ReportTargetKind, string> = {
  USER: "Kullanıcı",
  JOB: "İlan",
  MESSAGE: "Mesaj",
  IMAGE: "Görsel",
};

export function reportTargetLabel(kind: ReportTargetKind): string {
  return TARGET_LABELS[kind];
}

/**
 * What the report points at.
 *
 * A list rather than one value: `CreateReportDto.isPointingAtSomething()` only
 * requires *at least* one of the four, so a single report can name a user and
 * the message they sent. Collapsing that to "the first one" would hide the
 * message from the person reviewing it.
 */
export function reportTargets(report: Report): ReportTarget[] {
  const targets: ReportTarget[] = [];
  if (report.reportedUserId !== null) targets.push({ kind: "USER", id: report.reportedUserId });
  if (report.jobId !== null) targets.push({ kind: "JOB", id: report.jobId });
  if (report.messageId !== null) targets.push({ kind: "MESSAGE", id: report.messageId });
  if (report.imageId !== null) targets.push({ kind: "IMAGE", id: report.imageId });
  return targets;
}

export interface ReportQueueQuery {
  /** `null` her durum demektir — backend'e `status` gitmez (`ReportDao.search`: `:status is null`). */
  readonly status: ReportStatus | null;
  readonly reportedUserId?: string | null;
  /** koala-backend#283: şikayet eden; `reportedUserId` ile birlikte gönderilebilir. */
  readonly reporterId?: string | null;
  readonly paging: Paging;
  /** koala-backend#263: şikayet eden/edilenin ad-soyadı ve e-postası, ilan başlığı. */
  readonly query?: string | null;
  /** koala-backend#301: `createdAt` aralığı, dilimli ISO, iki sınır dahil. */
  readonly from?: string | null;
  readonly to?: string | null;
}

/**
 * One page of the queue.
 *
 * `status`, optional `reportedUserId`, and the three paging parameters all go on
 * the query string; nothing about the returned page is narrowed afterwards.
 * `reports.test.ts` asserts the exact URL, because "the filter goes to the
 * server" is a claim about a request and can only be checked as one.
 */
export function getReports(accessToken: string, query: ReportQueueQuery): Promise<PageDto<Report>> {
  return koalaApi.get({
    path: REPORTS_PATH,
    schema: pageDtoSchema(reportSchema),
    query: {
      status: query.status ?? undefined,
      reportedUserId: query.reportedUserId?.trim() || undefined,
      reporterId: query.reporterId?.trim() || undefined,
      query: searchQueryParam(query.query),
      from: query.from ?? undefined,
      to: query.to ?? undefined,
      ...pagingQuery(query.paging),
    },
    accessToken,
    cache: "no-store",
  });
}

export function reportDetailPath(reportId: string): string {
  return `${REPORTS_PATH}/${encodeURIComponent(reportId)}`;
}

/**
 * `GET /admin/reports/{id}` — `AdminReportDetailDto { report, content }`.
 *
 * Missing reports are `REPORT_NOT_FOUND`. Content is user-authored (job title,
 * message body, public image URL) and only this call returns it.
 */
export function getReport(accessToken: string, reportId: string): Promise<ReportDetail> {
  return koalaApi.get({
    path: reportDetailPath(reportId),
    schema: reportDetailSchema,
    accessToken,
    cache: "no-store",
  });
}

/**
 * The panel's floor for a review note.
 *
 * It lives here rather than next to the Server Action because a `"use server"`
 * module may only export async functions — a plain `export const` there is a
 * build error, and the number is needed by the form, the action and the page.
 * The backend has no such rule: `ReviewReportDto.note` is `@Size(max = 2000)`
 * with no `@NotBlank`, so an empty reason is accepted there. koala-admin#7 asks
 * for a written one, and this constant is where that difference lives.
 */
export const REVIEW_MIN_NOTE_LENGTH = 10;

export interface ReportReview {
  readonly status: ReportStatus;
  readonly note: string;
}

/**
 * `POST /admin/reports/{reportId}/review` — `ReviewReportDto { status, note }`.
 *
 * Note what the backend does *not* require: `note` is `@Size(max = 2000)` with
 * no `@NotBlank`, so an empty reason is accepted there. koala-admin#7 asks for
 * a written reason on every decision, so the panel requires one in the form and
 * again in the Server Action. That is a panel-side rule and this comment is the
 * honest record of it.
 *
 * `ReportManager.review` refuses a second verdict on an ACTIONED or DISMISSED
 * report with a 409; the screen says so before the button is pressed.
 */
export function reviewReport(
  accessToken: string,
  reportId: string,
  review: ReportReview,
): Promise<Report> {
  return koalaApi.post({
    path: `${reportDetailPath(reportId)}/review`,
    schema: reportSchema,
    body: { status: review.status, note: review.note },
    accessToken,
    cache: "no-store",
  });
}
