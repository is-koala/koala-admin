import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("IBAN verification is gated on bank.account.verify", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/iban-verifications");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "bank.account.verify" });
  });

  it("is invisible to a payout.reconcile holder", () => {
    expect(navigationFor(["payout.reconcile"]).map((entry) => entry.href)).not.toContain(
      "/iban-verifications",
    );
  });

  it("is the only entry someone holding just bank.account.verify sees", () => {
    expect(navigationFor(["bank.account.verify"]).map((entry) => entry.href)).toEqual([
      "/iban-verifications",
    ]);
  });
});
