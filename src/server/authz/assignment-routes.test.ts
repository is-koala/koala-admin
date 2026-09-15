import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("assignment lookup is gated on payment.read", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/assignments");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "payment.read" });
  });

  it("is invisible to a dispute.resolve holder", () => {
    expect(navigationFor(["dispute.resolve"]).map((entry) => entry.href)).not.toContain(
      "/assignments",
    );
  });

  it("shares payment.read's menu only with the payments list (koala-admin#111)", () => {
    expect(navigationFor(["payment.read"]).map((entry) => entry.href)).toEqual([
      "/assignments",
      "/payments",
    ]);
  });
});
