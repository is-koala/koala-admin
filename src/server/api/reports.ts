import "server-only";

import { z } from "zod";

import { koalaApi } from "./koala";
import { pagingQuery, type Paging, type PagingContract } from "./paging";
import { pageDtoSchema } from "./schemas";
import type { PageDto } from "./types";

/**
 * The report queue's contract with `webAPI/ReportsController.java`.
 *
 * Read the endpoint signature before reading anything else here, because most
 * of what this module does is work around it:
 *
 * ```java
 * @GetMapping("/admin/reports")
 * public ... byStatus(@RequestParam ReportStatus status, @PageableDefault(size = 20) Pageable pageable)
 * ```
 *
 * `status` has no `required = false` and no default, so **the queue is always
 * one status at a time** — there is no "all reports" view to build, and asking
 * for one would be a 400. That single parameter is also the *only* filter:
 * there is no filter by reason, by target type, by reporter or by reported
 * user, and no `GET /admin/reports/{id}` for a detail page.
 *
 * The panel does not paper over any of that. Every gap is listed in
 * {@link REPORT_BACKEND_GAPS} and rendered on the screen, because a moderation
 * queue that quietly filters twenty rows in the browser is worse than one that
 * admits it cannot filter at all.
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

/**
 * `core/dtos/report/response/ReportDto.java`.
 *
 * `reason` and `status` are `z.string()` rather than `z.enum(...)` on purpose.
 * A backend that ships a new enum member first would otherwise fail the whole
 * page's schema check, and an empty moderation queue that is *actually* full is
 * exactly the failure this screen exists to prevent. The filter still only ever
 * sends a value from {@link REPORT_STATUSES}, which is the direction that has
 * to be strict — Spring answers an unknown enum with 400.
 */
export const reportSchema = z.object({
  id: z.string(),
  reportedUserId: nullableString,
  jobId: nullableString,
  messageId: nullableString,
  imageId: nullableString,
  reason: z.string(),
  description: nullableString,
  status: z.string(),
  reviewNote: nullableString,
  reviewedAt: nullableString,
  createdAt: nullableString,
});

export type Report = z.infer<typeof reportSchema>;

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
  readonly status: ReportStatus;
  readonly paging: Paging;
}

/**
 * One page of the queue.
 *
 * `status` and the three paging parameters all go on the query string; nothing
 * about the returned page is narrowed afterwards. `reports.test.ts` asserts the
 * exact URL, because "the filter goes to the server" is a claim about a request
 * and can only be checked as one.
 */
export function getReports(accessToken: string, query: ReportQueueQuery): Promise<PageDto<Report>> {
  return koalaApi.get({
    path: REPORTS_PATH,
    schema: pageDtoSchema(reportSchema),
    query: { status: query.status, ...pagingQuery(query.paging) },
    accessToken,
    // A moderation queue is the last place to serve a cached page: the row an
    // operator is about to open may already have been decided by a colleague.
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
    path: `${REPORTS_PATH}/${encodeURIComponent(reportId)}/review`,
    schema: reportSchema,
    body: { status: review.status, note: review.note },
    accessToken,
    cache: "no-store",
  });
}

/**
 * What koala-admin#7 asks for that `ReportsController` cannot answer today.
 *
 * Kept as data rather than as prose scattered through the page so that the
 * screen and the hand-off to the backend team say the same thing, and so that
 * deleting a gap from the UI means deleting it from here — which is a diff
 * somebody reviews.
 */
export const REPORT_BACKEND_GAPS = [
  {
    id: "reporter",
    title: "Şikayet eden görünmüyor",
    detail:
      "`Report` varlığı `reporter` alanını tutuyor ama `ReportDto` onu döndürmüyor, bu yüzden kuyrukta şikayet eden sütunu yok. Aynı şekilde `reviewedBy` de dönmüyor: bir şikayeti kimin sonuçlandırdığı panelde görülemiyor.",
  },
  {
    id: "prior-count",
    title: "Şikayet edilenin geçmiş şikayet sayısı yok",
    detail:
      "Ne `ReportDto`'da bir sayaç var, ne de `GET /admin/reports` şikayet edilene göre süzülebiliyor (tek parametresi `status`). Bu yüzden 'bu kullanıcı hakkında daha önce kaç şikayet açıldı' sorusunun panelde doğru bir cevabı yok.",
  },
  {
    id: "grouping",
    title: "Aynı kullanıcı hakkındaki şikayetler gruplanamıyor",
    detail:
      "Gruplama, şikayet edilen kullanıcıya göre süzme gerektirir; böyle bir parametre yok. Panel yalnızca elindeki sayfada tekrar eden hedefleri işaretler ve bunu 'bu sayfada' diye söyler — kuyruğun tamamı için bir sayı vermez.",
  },
  {
    id: "context",
    title: "İlan / mesaj bağlamı yalnızca kimlik olarak geliyor",
    detail:
      "`ReportDto` ilan, mesaj ve görsel için yalnızca UUID döndürüyor; başlık, metin ya da görsel adresi yok. Şikayetin gerekçesi okunabiliyor, şikayet edilen içerik okunamıyor.",
  },
  {
    id: "detail-endpoint",
    title: "Tek bir şikayeti getiren uç yok",
    detail:
      "`GET /admin/reports/{id}` bulunmuyor. Bu yüzden detay, kuyruk sayfasında zaten gelmiş olan satırdan açılır; ayrı bir detay adresi olsaydı o adres sayfa numarasına bağlı kalırdı.",
  },
  {
    id: "follow-up",
    title: "Karar sonrası uygulama uçları eksik",
    detail:
      "Kullanıcı askıya alma / yasaklama ucu koala-backend'de hiç yok. İçerik kaldırma yalnızca görseller için var (`DELETE /admin/images/{imageId}`, aynı `content.moderate` izniyle); ilan ya da mesaj kaldıran bir uç yok. 'Haklı bulundu' kararı bunların hiçbirini kendiliğinden yapmaz.",
  },
] as const;
