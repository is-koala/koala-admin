import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

/**
 * koala-admin#95'in kayıt tablosu yarısı: beş nesne sayfası kuyruğuyla aynı
 * izni ister ve menüde görünmez; ilan listesi yeni `job.read` iznine bağlı
 * tek menü girişidir.
 */

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("object pages carry their queue's permission and stay out of the menu", () => {
  it.each([
    ["/assignments/[id]", "payment.read"],
    ["/payments/[id]", "payment.read"],
    ["/payout-reconciliation/[id]", "payout.reconcile"],
    ["/jobs/[id]", "job.read"],
    ["/iban-verifications/[reference]", "bank.account.verify"],
  ])("%s → %s, without a nav entry", (path, permission) => {
    const entry = entryFor(path);

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission });
    expect("nav" in entry).toBe(false);
  });
});

describe("the job list is gated on job.read", () => {
  it("is registered with that permission and advertised under operasyon", () => {
    const entry = entryFor("/jobs");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({
      permission: "job.read",
      nav: { label: "İlanlar", group: "operasyon" },
    });
  });

  it("is the only entry someone holding just job.read sees", () => {
    expect(navigationFor(["job.read"]).map((entry) => entry.href)).toEqual(["/jobs"]);
  });

  it("is invisible to a user.read holder, who still sees users", () => {
    expect(navigationFor(["user.read"]).map((entry) => entry.href)).toEqual(["/users"]);
  });

  it("does not add a menu entry for payment.read or payout.reconcile holders", () => {
    expect(navigationFor(["payment.read"]).map((entry) => entry.href)).toEqual([
      "/assignments",
      "/payments",
    ]);
    expect(navigationFor(["payout.reconcile"]).map((entry) => entry.href)).toEqual([
      "/payout-reconciliation",
    ]);
  });
});
