import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { isPermission } from "./permissions";
import { ROUTES, ROUTE_HANDLERS, gatedRoutes, navigationFor } from "./routes";

/**
 * The test that stops an ungated page being added.
 *
 * koala-backend#14 found that `/admin/**` sat behind one flat
 * `hasRole("ADMIN")`, so every endpoint written afterwards was open to every
 * admin without anyone deciding that. The panel's version of the same mistake
 * is a `page.tsx` with no gate, and it is prevented the same way: the
 * filesystem is the source of truth for what exists, `routes.ts` is the source
 * of truth for what each thing requires, and this file refuses to let them
 * disagree.
 *
 * Adding `src/app/(panel)/payouts/page.tsx` turns this red until somebody
 * writes down what it takes to reach it.
 */

const APP_DIR = fileURLToPath(new URL("../../app", import.meta.url));

/**
 * The complete list of things reachable without a permission, pinned here on
 * purpose.
 *
 * `routes.ts` already forces every one of them to carry a written reason. This
 * pin adds the second half: growing the list is a diff in a test file, which is
 * a thing a reviewer notices, rather than one more line in a long array.
 */
const EXPECTED_UNGATED: Record<string, "public" | "session"> = {
  "/giris": "public",
  "/giris/hata": "public",
  "/": "session",
  "/verification/job-categories": "session",
  "/api/auth/[...nextauth]": "public",
  "/api/health": "public",
};

/**
 * `src/app/(panel)/audit-log/page.tsx` → `/audit-log`.
 *
 * Route groups (`(panel)`) and parallel-route slots (`@modal`) shape the
 * filesystem but not the URL, so they are dropped — exactly as Next.js drops
 * them — and what is left is the path a person types.
 */
function routePathFor(relativeFile: string): string {
  const segments = relativeFile
    .split(path.sep)
    .slice(0, -1)
    .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith("@"));

  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}

/** Route path → the file serving it, for both `page` and `route` files. */
async function scanAppDir(
  dir: string = APP_DIR,
): Promise<{ pages: Map<string, string>; handlers: Map<string, string> }> {
  const pages = new Map<string, string>();
  const handlers = new Map<string, string>();

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      const nested = await scanAppDir(full);
      for (const [route, file] of nested.pages) pages.set(route, file);
      for (const [route, file] of nested.handlers) handlers.set(route, file);
      continue;
    }

    const route = routePathFor(path.relative(APP_DIR, full));
    if (/^page\.(tsx|ts|jsx|js)$/.test(entry.name)) pages.set(route, full);
    if (/^route\.(tsx|ts|jsx|js)$/.test(entry.name)) handlers.set(route, full);
  }

  return { pages, handlers };
}

describe("the route registry covers what the filesystem serves", () => {
  it("has an entry for every page under src/app", async () => {
    const { pages } = await scanAppDir();
    const registered = new Set<string>(ROUTES.map((route) => route.path));

    const unregistered = [...pages.keys()].filter((page) => !registered.has(page));

    // The failure message is the point: whoever added the page has to say what
    // it takes to reach it, in src/server/authz/routes.ts.
    expect(
      unregistered,
      "Kayıt tablosunda olmayan sayfa(lar). src/server/authz/routes.ts'e ekleyin ve bir izin adı verin.",
    ).toEqual([]);
  });

  it("has an entry for every route handler under src/app", async () => {
    const { handlers } = await scanAppDir();
    const registered = new Set<string>(ROUTE_HANDLERS.map((route) => route.path));

    expect([...handlers.keys()].filter((handler) => !registered.has(handler))).toEqual([]);
  });

  it("points at nothing that has stopped existing", async () => {
    const { pages, handlers } = await scanAppDir();

    expect(ROUTES.map((route) => route.path).filter((p) => !pages.has(p))).toEqual([]);
    expect(ROUTE_HANDLERS.map((route) => route.path).filter((p) => !handlers.has(p))).toEqual([]);
  });

  it("finds at least the pages this slice ships, so an empty scan cannot pass", async () => {
    const { pages } = await scanAppDir();
    expect([...pages.keys()]).toContain("/audit-log");
    expect([...pages.keys()]).toContain("/job-categories");
    expect(pages.size).toBeGreaterThanOrEqual(6);
  });
});

describe("every protected route carries a permission", () => {
  it("names a permission from the catalogue, never free text", () => {
    for (const route of gatedRoutes()) {
      expect(isPermission(route.permission), `${route.path} → ${route.permission}`).toBe(true);
    }
  });

  it("leaves exactly the ungated routes that were argued for, and no others", () => {
    const ungated = [...ROUTES, ...ROUTE_HANDLERS]
      .filter((route) => route.access !== "permission")
      .map((route) => [route.path, route.access] as const);

    expect(Object.fromEntries(ungated)).toEqual(EXPECTED_UNGATED);
  });

  it("makes every ungated route explain itself in writing", () => {
    for (const route of [...ROUTES, ...ROUTE_HANDLERS]) {
      if (route.access === "permission") continue;
      // The type already requires the field; this catches an empty string,
      // which the type cannot.
      expect(route.ungatedReason.length, route.path).toBeGreaterThan(40);
    }
  });

  it("renders the gate the registry promises, in the page itself", async () => {
    // The registry saying `/audit-log` needs `audit.read` protects nobody if
    // the page forgets to ask. This is the one check that ties the two
    // together, and it is why RequirePermission takes a literal.
    const { pages } = await scanAppDir();

    for (const route of gatedRoutes()) {
      const file = pages.get(route.path);
      if (file === undefined) throw new Error(`${route.path} için page dosyası yok.`);
      const source = await readFile(file, "utf8");

      expect(
        source.includes(`permission="${route.permission}"`),
        `${route.path} sayfası kayıt tablosundaki ${route.permission} iznini istemiyor.`,
      ).toBe(true);
    }
  });
});

describe("the menu is drawn from the registry and from permissions only", () => {
  it("shows a CATALOG_EDITOR's category.manage nothing but iş kategorileri", () => {
    const entries = navigationFor(["category.manage"]);

    expect(entries.map((entry) => entry.href)).toEqual(["/job-categories"]);
  });

  it("shows both entries to someone holding both permissions", () => {
    const entries = navigationFor(["audit.read", "category.manage"]);

    expect(entries.map((entry) => entry.href)).toEqual(["/job-categories", "/audit-log"]);
  });

  it("draws nothing at all for an empty permission list", () => {
    // The fail-closed path. Not a partial menu, not a menu of disabled items.
    expect(navigationFor([])).toEqual([]);
  });

  it("never advertises a route it does not also gate", () => {
    // A menu entry on a session-only route would be a link the panel offers and
    // does not check.
    for (const route of ROUTES) {
      if ("nav" in route && route.nav !== undefined) {
        expect(route.access, route.path).toBe("permission");
      }
    }
  });

  it("gives every menu entry a distinct place and label", () => {
    const entries = navigationFor(gatedRoutes().map((route) => route.permission));

    expect(new Set(entries.map((entry) => entry.order)).size).toBe(entries.length);
    expect(new Set(entries.map((entry) => entry.label)).size).toBe(entries.length);
  });
});
