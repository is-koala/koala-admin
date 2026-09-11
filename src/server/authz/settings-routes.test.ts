import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("the runtime settings screen is gated on settings.manage", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/settings");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "settings.manage" });
  });

  it("is invisible to a CATALOG_EDITOR", () => {
    expect(navigationFor(["category.manage"]).map((entry) => entry.href)).not.toContain(
      "/settings",
    );
  });

  it("is the only entry someone holding just settings.manage sees", () => {
    expect(navigationFor(["settings.manage"]).map((entry) => entry.href)).toEqual(["/settings"]);
  });
});
