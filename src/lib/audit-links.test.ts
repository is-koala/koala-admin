import { describe, expect, it } from "vitest";

import type { Permission } from "@/server/authz/permissions";

import { auditActorHref, auditResourceHref, staffMemberHref } from "./audit-links";

/**
 * koala-admin#107: denetim satırından nesneye ve personele giden bağlantı
 * yalnız hedef sayfanın izni varken verilir; backend'in `resourceType`
 * parçaları panel rotalarına böyle çevrilir.
 */

const ID = "9a1c0f10-0001-4c00-8000-000000000009";
const held = (...permissions: Permission[]) => new Set<Permission>(permissions);

describe("auditResourceHref", () => {
  it.each([
    ["users", "user.read", `/users/${ID}`],
    ["job-assignments", "payment.read", `/assignments/${ID}`],
    ["payments", "payment.read", `/payments/${ID}`],
    ["payouts", "payout.reconcile", `/payout-reconciliation/${ID}`],
    ["companies", "company.approve", `/companies/${ID}`],
    ["disputes", "dispute.resolve", `/disputes/${ID}`],
    ["jobs", "job.read", `/jobs/${ID}`],
    ["reports", "content.moderate", `/reports/${ID}`],
    ["identity-verifications", "identity.review", `/identity-reviews/${ID}`],
    ["account-deletions", "user.read_pii", `/account-deletions/${ID}`],
    ["staff", "staff.read", `/staff#personel-${ID}`],
  ] as const)("maps %s to its object page when %s is held", (type, permission, href) => {
    expect(auditResourceHref(type, ID, held(permission))).toBe(href);
    expect(auditResourceHref(type, ID, held())).toBeNull();
  });

  it("addresses an IBAN verification by its free-text reference", () => {
    expect(
      auditResourceHref("bank-account-verifications", "KOALA-9F3A", held("bank.account.verify")),
    ).toBe("/iban-verifications/KOALA-9F3A");
  });

  it("refuses a non-UUID id for UUID-addressed pages, an unknown type and an empty id", () => {
    expect(auditResourceHref("users", "not-a-uuid", held("user.read"))).toBeNull();
    expect(auditResourceHref("job-category", ID, held("category.manage"))).toBeNull();
    expect(auditResourceHref("users", "", held("user.read"))).toBeNull();
  });
});

describe("auditActorHref", () => {
  it("links the actor to the staff page anchor only for a staff.read holder", () => {
    expect(auditActorHref(ID, held("staff.read"))).toBe(staffMemberHref(ID));
    expect(auditActorHref(ID, held("audit.read"))).toBeNull();
  });

  it("has nowhere to send a row without a staff id", () => {
    expect(auditActorHref(null, held("staff.read"))).toBeNull();
    expect(auditActorHref("bridge-admin", held("staff.read"))).toBeNull();
  });
});
