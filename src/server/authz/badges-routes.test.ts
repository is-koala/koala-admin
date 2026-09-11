import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("the badge catalogue screen is gated on badge.manage", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/badges");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "badge.manage" });
  });

  it("is invisible to a CATALOG_EDITOR", () => {
    expect(navigationFor(["category.manage"]).map((entry) => entry.href)).not.toContain("/badges");
  });

  it("is the only entry someone holding just badge.manage sees", () => {
    expect(navigationFor(["badge.manage"]).map((entry) => entry.href)).toEqual(["/badges"]);
  });
});
