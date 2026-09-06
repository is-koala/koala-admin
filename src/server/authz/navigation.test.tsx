import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeNoStaffRecordBody, adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

/**
 * The menu, rendered through the real panel shell.
 *
 * `routes.test.ts` proves `navigationFor()` maps permissions to entries;
 * this file proves the shell asks the backend and draws that answer — the two
 * halves of "the menu only shows what the user's permissions allow". The
 * interesting cases are the failures: a 500 has to empty the menu completely,
 * not partially, and a partial menu is exactly what a well-meaning fallback
 * would produce.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  getIdTokenHint: () => Promise.resolve(null),
}));

/**
 * The shell's sign-out button is a Server Action, and the real one drags in
 * `next-auth`, which cannot be resolved under the jsdom project's conditions.
 * It is also not what this file is about: `logout.test.ts` covers it.
 */
vi.mock("@/server/auth/actions", () => ({
  signOutFromKeycloak: async () => undefined,
}));

const { default: PanelLayout } = await import("@/app/(panel)/layout");

const ADMIN_ME = apiUrl("/admin/me");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

/** `href="…"` of every link the shell drew inside the menu. */
function menuLinks(html: string): string[] {
  const nav = /<nav[^>]*aria-label="Panel menüsü"[^>]*>([\s\S]*?)<\/nav>/.exec(html);
  if (nav === null) throw new Error("Panel menüsü render edilmedi.");
  return [...(nav[1] ?? "").matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? "");
}

const shell = () => renderServerComponent(<PanelLayout>{null}</PanelLayout>);

describe("the menu is exactly what the backend permits", () => {
  it("shows a CATALOG_EDITOR iş kategorileri and nothing else", async () => {
    stubMe(["category.manage"], ["CATALOG_EDITOR"]);

    const html = await shell();

    expect(menuLinks(html)).toEqual(["/job-categories"]);
    expect(html).not.toContain(">Denetim kaydı<");
  });

  it("shows an OWNER both entries", async () => {
    stubMe(["audit.read", "category.manage"], ["OWNER"]);

    const html = await shell();

    expect(menuLinks(html)).toEqual(["/job-categories", "/audit-log"]);
  });

  it("draws no menu at all when /admin/me answers 500", async () => {
    // Not a partial menu, and not a menu of disabled entries: the fail-closed
    // path arrives here as an empty permission list, and an empty list has no
    // branch that draws anything.
    server.use(
      http.get(ADMIN_ME, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            correlationId: "cid-500",
            path: "/admin/me",
            timeStamp: "2026-09-06T09:24:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );

    const html = await shell();

    expect(menuLinks(html)).toEqual([]);
    expect(html).toContain("staff-nav-empty");
    // And the emptiness is explained rather than left to look like "you have
    // no permissions".
    expect(html).toContain("İzinleriniz çözülemedi");
    expect(html).toContain("cid-500");
  });

  it("draws no menu when the backend cannot be reached at all", async () => {
    server.use(http.get(ADMIN_ME, () => HttpResponse.error()));

    const html = await shell();

    expect(menuLinks(html)).toEqual([]);
  });

  it("draws no menu for a Keycloak identity with no staff record, and says why", async () => {
    // The migration window's normal state: signed in, reaching nothing, and
    // told which door has not been opened yet.
    server.use(
      http.get(ADMIN_ME, () => HttpResponse.json(adminMeNoStaffRecordBody, { status: 403 })),
    );

    const html = await shell();

    expect(menuLinks(html)).toEqual([]);
    expect(html).toContain("personel kaydınız yok");
    // They can still leave.
    expect(html).toContain("Çıkış yap");
  });

  it("draws no menu when the backend grants permissions this panel has no screen for", async () => {
    // `staff.manage` and `role.manage` are in the catalogue and have no screen
    // in slice 1. Holding them must not conjure a menu entry.
    stubMe(["staff.manage", "role.manage", "payout.release"], ["OWNER"]);

    const html = await shell();

    expect(menuLinks(html)).toEqual([]);
  });
});
