import { describe, expect, it } from "vitest";

import {
  AUDIT_FILTER_NAMES,
  AUDIT_PAGE_SIZE,
  activeFilters,
  auditLogQuery,
  hasActiveFilters,
  hasDetailRecord,
  parseAuditLogRequest,
  type AuditEntry,
} from "./audit-log";

/**
 * The filter layer, tested away from the network.
 *
 * `audit.test.ts` proves these values reach the wire; this file proves they are
 * the right values in the first place — which is the half that a request
 * assertion cannot see, because a query parameter carrying the wrong instant
 * looks exactly like one carrying the right one.
 */

const ALL_FILTERS = {
  actor: "Katalog Editörü",
  action: "job-category.create",
  permission: "category.manage",
  resourceType: "job-category",
  resourceId: "9a1c0f10-0001-4c00-8000-000000000009",
  from: "2026-09-01",
  to: "2026-09-06",
  allowed: "false",
};

describe("parseAuditLogRequest", () => {
  it("reads every filter koala-backend#15 accepts, under its own name", () => {
    const request = parseAuditLogRequest(ALL_FILTERS);

    expect(request.filters).toEqual(ALL_FILTERS);
    // If the backend grows a filter, this is the list that has to grow with it.
    expect(activeFilters(request.filters)).toEqual([...AUDIT_FILTER_NAMES]);
  });

  it("treats a missing search param object as no filters at all", () => {
    const request = parseAuditLogRequest(undefined);

    expect(hasActiveFilters(request.filters)).toBe(false);
    expect(request.page).toBe(0);
    expect(request.size).toBe(AUDIT_PAGE_SIZE);
  });

  it("treats an empty form field as absent rather than as a filter on ''", () => {
    // A GET form submits every control, so an untouched box arrives as
    // `actor=`. Passing that through would filter on the empty string.
    const request = parseAuditLogRequest({ actor: "", action: "   ", permission: "user.read" });

    expect(request.filters.actor).toBeNull();
    expect(request.filters.action).toBeNull();
    expect(request.filters.permission).toBe("user.read");
  });

  it("defaults `allowed` to unset, so refused attempts are never hidden", () => {
    // The default matters more than it looks: `allowed=true` would hide every
    // refusal, and the refusals are what this screen exists for.
    expect(parseAuditLogRequest({}).filters.allowed).toBeNull();
    expect(parseAuditLogRequest({ allowed: "false" }).filters.allowed).toBe("false");
    expect(parseAuditLogRequest({ allowed: "evet" }).filters.allowed).toBeNull();
  });

  it("refuses a date that is not a calendar day", () => {
    const request = parseAuditLogRequest({ from: "dün", to: "2026-13-99x" });

    expect(request.filters.from).toBeNull();
    expect(request.filters.to).toBeNull();
  });

  it("falls back to the first page for a nonsense page number", () => {
    expect(parseAuditLogRequest({ page: "3" }).page).toBe(3);
    expect(parseAuditLogRequest({ page: "-1" }).page).toBe(0);
    expect(parseAuditLogRequest({ page: "2.5" }).page).toBe(0);
    expect(parseAuditLogRequest({ page: "son" }).page).toBe(0);
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseAuditLogRequest({ actor: ["ilk", "ikinci"] }).filters.actor).toBe("ilk");
  });
});

describe("auditLogQuery", () => {
  it("sends every filter under the backend's own parameter name", () => {
    const query = auditLogQuery(parseAuditLogRequest({ ...ALL_FILTERS, page: "2" }));

    expect(query.actor).toBe("Katalog Editörü");
    expect(query.action).toBe("job-category.create");
    expect(query.permission).toBe("category.manage");
    expect(query.resourceType).toBe("job-category");
    expect(query.resourceId).toBe("9a1c0f10-0001-4c00-8000-000000000009");
    expect(query.allowed).toBe("false");
    expect(query.page).toBe(2);
    expect(query.size).toBe(AUDIT_PAGE_SIZE);
  });

  it("turns a calendar day into the Istanbul day it means, in UTC", () => {
    // 2026-09-01 in Istanbul starts at 21:00 UTC the day before. Sending the
    // bare date would leave the backend to guess a zone, and the three hours
    // that guess gets wrong are three hours of audit rows.
    const query = auditLogQuery(parseAuditLogRequest({ from: "2026-09-01", to: "2026-09-06" }));

    expect(query.from).toBe("2026-08-31T21:00:00.000Z");
    // The end of the range is inclusive of the whole day.
    expect(query.to).toBe("2026-09-06T20:59:59.999Z");
  });

  it("omits an unset filter instead of sending it as null", () => {
    const query = auditLogQuery(parseAuditLogRequest({}));

    for (const name of AUDIT_FILTER_NAMES) {
      expect(query[name], name).toBeNull();
    }
    // `buildKoalaUrl` drops nulls; koala.test.ts pins that behaviour.
    expect(query.page).toBe(0);
  });
});

describe("hasDetailRecord", () => {
  const core: AuditEntry = {
    id: "1",
    occurredAt: "2026-09-06T06:20:31.000Z",
    actorStaffId: "s1",
    actorDisplayName: "Personel",
    permission: "category.manage",
    action: "job-category.create",
    resourceType: "job-category",
    resourceId: "r1",
    allowed: true,
    mutating: true,
    sensitivity: "NORMAL",
    requestBody: null,
    ip: null,
    userAgent: null,
    before: null,
    after: null,
  };

  it("is false only when the whole detail half is gone", () => {
    expect(hasDetailRecord(core)).toBe(false);
    expect(hasDetailRecord({ ...core, ip: "10.0.0.1" })).toBe(true);
    expect(hasDetailRecord({ ...core, after: "{}" })).toBe(true);
  });
});
