import type { Route } from "next";

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

export function assignmentLookupHref(assignmentId: string): Route {
  return asRoute(`/assignments?atama=${encodeURIComponent(assignmentId)}`);
}

export function reportsForUserHref(userId: string): Route {
  return asRoute(`/reports?kullanici=${encodeURIComponent(userId)}`);
}

export function payoutReconcileHref(payoutId: string): Route {
  return asRoute(`/payout-reconciliation?hakedis=${encodeURIComponent(payoutId)}`);
}
