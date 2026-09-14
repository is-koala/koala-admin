import type { Route } from "next";

import { USER_TAB_PARAM, type UserTab } from "@/lib/user-tabs";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** TypedRoutes rejects a raw string interpolation; the cast is the #67 seam. */
function asRoute(path: string): Route {
  return path as Route;
}

function withQuery(path: string, state: Readonly<Record<string, string>> = {}): Route {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(state)) {
    if (value.length > 0) query.set(name, value);
  }
  const encoded = query.toString();
  return asRoute(encoded.length > 0 ? `${path}?${encoded}` : path);
}

/**
 * Bir liste sayfasının kendi adresi, verilen görünümle. Arama kutusunun
 * "Temizle" bağlantısı bunu kullanır: `q` düşer, durum/sıralama/boyut kalır.
 */
export function listHref(pathname: string, state: Readonly<Record<string, string>> = {}): Route {
  return withQuery(pathname, state);
}

export function reportHref(reportId: string): Route {
  return asRoute(`/reports/${reportId}`);
}

export function companiesHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/companies", state);
}

export function companyHref(
  companyId: string,
  queueState: Readonly<Record<string, string>> = {},
): Route {
  return withQuery(`/companies/${companyId}`, queueState);
}

export function identityReviewsHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/identity-reviews", state);
}

export function identityReviewHref(
  reviewId: string,
  queueState: Readonly<Record<string, string>> = {},
): Route {
  return withQuery(`/identity-reviews/${reviewId}`, queueState);
}

export function accountDeletionsHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/account-deletions", state);
}

export function accountDeletionHref(
  requestId: string,
  queueState: Readonly<Record<string, string>> = {},
): Route {
  return withQuery(`/account-deletions/${requestId}`, queueState);
}

export function disputeHref(disputeId: string): Route {
  return asRoute(`/disputes/${disputeId}`);
}

export function userHref(userId: string): Route {
  return asRoute(`/users/${userId}`);
}

export function userHrefOrNull(userId: string | null | undefined): Route | null {
  return userId !== null && userId !== undefined && isUuid(userId) ? userHref(userId) : null;
}

/** Sekme `?sekme=` ile taşınır; `genel` varsayılan olduğu için adrese yazılmaz. */
export function userTabHref(userId: string, tab: UserTab): Route {
  return withQuery(`/users/${userId}`, tab === "genel" ? {} : { [USER_TAB_PARAM]: tab });
}

/** Atama nesne sayfası (koala-admin#95); `?atama=` bakışı liste sayfasında kaldı. */
export function assignmentHref(assignmentId: string): Route {
  return asRoute(`/assignments/${assignmentId}`);
}

export function paymentHref(paymentId: string): Route {
  return asRoute(`/payments/${paymentId}`);
}

export function payoutHref(payoutId: string): Route {
  return asRoute(`/payout-reconciliation/${payoutId}`);
}

export function jobHref(jobId: string): Route {
  return asRoute(`/jobs/${jobId}`);
}

export function jobsHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/jobs", state);
}

/**
 * Referans UUID değil, backend'in ürettiği serbest metindir (`KOALA-9F3A`);
 * yol parçası olarak kodlanır ki `/` ya da `?` içeren bir referans rotayı
 * bozmasın.
 */
export function ibanVerificationHref(reference: string): Route {
  return asRoute(`/iban-verifications/${encodeURIComponent(reference)}`);
}

export function reportsForUserHref(userId: string): Route {
  return asRoute(`/reports?kullanici=${encodeURIComponent(userId)}`);
}

/**
 * Süzgeçli listeler (koala-admin#100). Anahtarlar panelin Türkçe URL
 * sözlüğünden: `kullanici` şikayet edilen için zaten vardı; `sikayetci`,
 * `isci`, `isveren` ve `sirket` aynı kalıpla eklendi. Liste sayfası anahtarı
 * okur ve backend'in `reporterId` / `workerId` / `employerId` / `companyId`
 * / `userId` parametresine çevirir; kimlik UUID değilse süzgeç düşer.
 */
export function reportsHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/reports", state);
}

/**
 * Kullanıcı sayfasındaki sayaçlar için: backend sayaçları her durumu sayar,
 * bağlantı da her durumu listelesin (`durum=hepsi`); `reportsForUserHref`
 * moderasyon bağlamı için açık kuyruğa gitmeye devam eder.
 */
export const ALL_STATUSES_PARAM = "hepsi";

export function reportsAboutUserHref(userId: string): Route {
  return reportsHref({ kullanici: userId, durum: ALL_STATUSES_PARAM });
}

export function reportsByReporterHref(userId: string): Route {
  return reportsHref({ sikayetci: userId, durum: ALL_STATUSES_PARAM });
}

export function assignmentsHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/assignments", state);
}

export function assignmentsForWorkerHref(userId: string): Route {
  return assignmentsHref({ isci: userId });
}

export function assignmentsForEmployerHref(userId: string): Route {
  return assignmentsHref({ isveren: userId });
}

export function payoutsHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/payout-reconciliation", state);
}

/** Kuyruk varsayılanı PROCESSING; sayaç her durumu saydığı için `durum=hepsi`. */
export function payoutsForWorkerHref(userId: string): Route {
  return payoutsHref({ isci: userId, durum: ALL_STATUSES_PARAM });
}

export function disputesHref(state: Readonly<Record<string, string>> = {}): Route {
  return withQuery("/disputes", state);
}

export function disputesForUserHref(userId: string): Route {
  return disputesHref({ kullanici: userId });
}

/** Uyuşmazlık ucu "hepsi" almaz: bekleyenler `disputesForUserHref`, çözülmüşler burası. */
export function resolvedDisputesForUserHref(userId: string): Route {
  return disputesHref({ kullanici: userId, durum: "RESOLVED" });
}

export function jobsForCompanyHref(companyId: string): Route {
  return jobsHref({ sirket: companyId });
}

export function payoutReconcileHref(payoutId: string): Route {
  return asRoute(`/payout-reconciliation?hakedis=${encodeURIComponent(payoutId)}`);
}

/** Bir kaydın bütün denetim satırları; süzgeç adı backend'in `resourceId` parametresi. */
export function auditLogForResourceHref(resourceId: string): Route {
  return withQuery("/audit-log", { resourceId });
}

/**
 * Personel sayfası üyeye `id="personel-<id>"` verir; satır içi bağlantı ve
 * denetim/çizelge aktör bağlantısı aynı çapayı kullanır (koala-admin#107).
 */
export function staffMemberAnchor(staffId: string): string {
  return `personel-${staffId}`;
}

export function staffMemberHref(staffId: string): Route {
  return asRoute(`/staff#${staffMemberAnchor(staffId)}`);
}
