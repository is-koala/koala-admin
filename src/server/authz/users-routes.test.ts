import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("the marketplace user directory is gated on user.read", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/users");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "user.read" });
  });

  it("is invisible to a CATALOG_EDITOR", () => {
    expect(navigationFor(["category.manage"]).map((entry) => entry.href)).not.toContain("/users");
  });

  it("is the only entry someone holding just user.read sees", () => {
    expect(navigationFor(["user.read"]).map((entry) => entry.href)).toEqual(["/users"]);
  });

  it("registers the object page without advertising it in the menu", () => {
    const entry = entryFor("/users/[id]");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "user.read" });
    expect(navigationFor(["user.read"]).map((entry) => entry.href)).not.toContain("/users/[id]");
  });
});
