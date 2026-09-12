import { describe, expect, it } from "vitest";

import { ROUTES, navigationFor } from "./routes";

/**
 * The two registry entries wave 4 adds, pinned in their own file.
 *
 * `routes.test.ts` already proves the general rules — every page is registered,
 * every gated route names a real permission, the menu comes from the registry
 * alone. This file pins the two specific answers those rules do not fix, and it
 * is separate on purpose: three moderation slices land on this registry at
 * once, and a merge that silently drops one of these entries would leave a page
 * unreachable with every shared test still green.
 */

function entryFor(path: string) {
  const entry = ROUTES.find((route) => route.path === path);
  if (entry === undefined) throw new Error(`${path} kayıt tablosunda yok.`);
  return entry;
}

describe("the report queue is gated on content.moderate", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/reports");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "content.moderate" });
  });

  it("is invisible to a DISPUTE_HANDLER", () => {
    // The whole reason koala-admin#7 chose `content.moderate`: resolving money
    // disputes must not come with the power to act on reported content.
    // Asserted as an absence rather than an empty menu: koala-admin#6 gives
    // `dispute.resolve` its own entry, and pinning the whole list here would
    // fail every time an unrelated screen is added, which teaches the next
    // person to loosen the assertion instead of reading it.
    expect(navigationFor(["dispute.resolve"]).map((entry) => entry.href)).not.toContain("/reports");
  });

  it("is the only entry a MODERATOR sees", () => {
    expect(navigationFor(["content.moderate"]).map((entry) => entry.href)).toEqual(["/reports"]);
  });

  it("registers the report object page without advertising it in the menu", () => {
    const entry = entryFor("/reports/[id]");

    expect(entry).toMatchObject({ permission: "content.moderate" });
    expect(navigationFor(["content.moderate"]).map((entry) => entry.href)).not.toContain(
      "/reports/[id]",
    );
  });
});

describe("the company approval queue is gated on company.approve", () => {
  it("is registered with that permission and no other", () => {
    const entry = entryFor("/companies");

    expect(entry.access).toBe("permission");
    expect(entry).toMatchObject({ permission: "company.approve" });
  });

  it("is invisible to someone who can only moderate content", () => {
    expect(navigationFor(["content.moderate"]).map((entry) => entry.href)).not.toContain(
      "/companies",
    );
  });

  it("is the only entry someone holding just company.approve sees", () => {
    expect(navigationFor(["company.approve"]).map((entry) => entry.href)).toEqual(["/companies"]);
  });

  it("registers the company object page without advertising it in the menu", () => {
    const entry = entryFor("/companies/[id]");

    expect(entry).toMatchObject({ permission: "company.approve" });
    expect(navigationFor(["company.approve"]).map((entry) => entry.href)).not.toContain(
      "/companies/[id]",
    );
  });
});

describe("the two together", () => {
  it("sit between iş kategorileri and the denetim kaydı", () => {
    const entries = navigationFor([
      "category.manage",
      "content.moderate",
      "company.approve",
      "audit.read",
    ]);

    expect(entries.map((entry) => entry.href)).toEqual([
      "/job-categories",
      "/reports",
      "/companies",
      "/audit-log",
    ]);
  });

  it("are drawn for nobody when permissions could not be resolved", () => {
    // The fail-closed path: `getStaffContext()` turns every failure into an
    // empty list, and an empty list has no branch that draws a queue.
    expect(navigationFor([])).toEqual([]);
  });
});

describe("the dispute object page is gated on dispute.resolve", () => {
  it("is registered and stays off the menu", () => {
    const entry = entryFor("/disputes/[id]");

    expect(entry).toMatchObject({ permission: "dispute.resolve" });
    expect(navigationFor(["dispute.resolve"]).map((entry) => entry.href)).toEqual(["/disputes"]);
  });
});

describe("the identity review object page is gated on identity.review", () => {
  it("is registered and stays off the menu", () => {
    const entry = entryFor("/identity-reviews/[id]");

    expect(entry).toMatchObject({ permission: "identity.review" });
    expect(navigationFor(["identity.review"]).map((entry) => entry.href)).toEqual([
      "/identity-reviews",
    ]);
  });
});
