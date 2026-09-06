import { describe, expect, it } from "vitest";

import { PERMISSIONS, PERMISSION_SPECS, isPermission, permissionLabel } from "./permissions";

/**
 * The catalogue is a contract with koala-backend#14, so these tests read like a
 * transcription of it rather than like unit tests. That is deliberate: if the
 * backend adds a permission and the panel does not, a gate somewhere is named
 * after a permission nobody can hold.
 */

/** koala-backend#14, verbatim. */
const EXPECTED = [
  "audit.read",
  "badge.manage",
  "category.manage",
  "company.approve",
  "content.moderate",
  "dispute.resolve",
  "finance.read",
  "payment.read",
  "payment.refund",
  "payout.release",
  "role.manage",
  "settings.manage",
  "staff.manage",
  "user.read",
  "user.read_pii",
  "user.role.manage",
];

describe("the permission catalogue", () => {
  it("names the sixteen permissions koala-backend#14 defines, and no others", () => {
    expect([...PERMISSIONS].sort()).toEqual(EXPECTED);
  });

  it("carries no duplicates", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });

  it("records the mutating flag and sensitivity the backend assigns", () => {
    const byName = new Map(PERMISSION_SPECS.map((spec) => [spec.name, spec]));

    // The four that decide who may touch money, and the three carrying
    // personal data — the rows an audit review actually reads.
    expect(byName.get("payout.release")).toMatchObject({
      mutating: true,
      sensitivity: "FINANCIAL",
    });
    expect(byName.get("payment.refund")).toMatchObject({
      mutating: true,
      sensitivity: "FINANCIAL",
    });
    expect(byName.get("payment.read")).toMatchObject({ mutating: false, sensitivity: "FINANCIAL" });
    expect(byName.get("finance.read")).toMatchObject({ mutating: false, sensitivity: "FINANCIAL" });

    expect(byName.get("user.read_pii")).toMatchObject({
      mutating: false,
      sensitivity: "PERSONAL_DATA",
    });
    expect(byName.get("audit.read")).toMatchObject({
      mutating: false,
      sensitivity: "PERSONAL_DATA",
    });
    expect(byName.get("staff.manage")).toMatchObject({
      mutating: true,
      sensitivity: "PERSONAL_DATA",
    });

    // `content.moderate` exists precisely so image removal is *not* reachable
    // through `dispute.resolve` — see koala-admin#5's second comment and
    // docs/keycloak-setup.md §3 on separation of duties.
    expect(byName.get("content.moderate")).toMatchObject({
      mutating: true,
      sensitivity: "NORMAL",
    });
  });

  it("gives every permission words a person can read", () => {
    for (const permission of PERMISSIONS) {
      expect(permissionLabel(permission).length).toBeGreaterThan(0);
    }
  });

  it("refuses names it does not know", () => {
    // A backend that grows a seventeenth permission must not be able to widen
    // the panel's vocabulary by simply naming it in a response.
    expect(isPermission("category.manage")).toBe(true);
    expect(isPermission("category.mange")).toBe(false);
    expect(isPermission("ROLE_ADMIN")).toBe(false);
    expect(isPermission("*")).toBe(false);
    expect(isPermission(null)).toBe(false);
    expect(isPermission({ name: "category.manage" })).toBe(false);
  });

  it("carries no role names, because roles do not live in the panel", () => {
    // ADR-0010: role membership is Keycloak's, the role→permission graph is the
    // backend's. A role name appearing in the catalogue would be the first step
    // towards resolving permissions in the panel.
    const serialised = JSON.stringify(PERMISSION_SPECS);
    for (const role of [
      "OWNER",
      "CATALOG_EDITOR",
      "SUPPORT_AGENT",
      "MODERATOR",
      "DISPUTE_HANDLER",
      "COMPANY_APPROVER",
      "TRUST_LEAD",
      "FINANCE_ANALYST",
      "FINANCE_OFFICER",
      "AUDITOR",
    ]) {
      expect(serialised).not.toContain(role);
    }
  });
});
