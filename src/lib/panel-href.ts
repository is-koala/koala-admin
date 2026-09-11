import type { Route } from "next";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** TypedRoutes rejects a raw string interpolation; the cast is the #67 seam. */
function asRoute(path: string): Route {
  return path as Route;
}

export function reportHref(reportId: string): Route {
  return asRoute(`/reports/${reportId}`);
}

export function companyHref(companyId: string): Route {
  return asRoute(`/companies/${companyId}`);
}

export function disputeHref(disputeId: string): Route {
  return asRoute(`/disputes/${disputeId}`);
}

export function userHref(userId: string): Route {
  return asRoute(`/users/${userId}`);
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
