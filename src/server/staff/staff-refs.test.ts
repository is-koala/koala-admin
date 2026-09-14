import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { staffMemberHref } from "@/lib/panel-href";

import { resolveStaffRefs, staffRefFor } from "./staff-refs";

/**
 * Personel kimliği → ad çözümü (koala-admin#112). Üç durum: dolu, hata,
 * izinsiz. Dördüncüsü sayının kendisi: aynı kimlik sayfada iki kez geçse de
 * `GET /admin/staff/{id}` bir kez çıkar.
 */

const ALICE = "5f000000-0000-4000-8000-000000000055";
const BOB = "5f000000-0000-4000-8000-000000000056";
const NAMELESS = "5f000000-0000-4000-8000-000000000057";

const STAFF = apiUrl("/admin/staff/:staffId");

function member(id: string, displayName: string | null, email: string) {
  return {
    id,
    email,
    displayName,
    active: true,
    mustChangePassword: false,
    lockedUntil: null,
    createdAt: "2026-09-01T08:00:00Z",
    roles: ["SUPPORT_AGENT"],
  };
}

function watchStaff() {
  const seen: { ids: string[]; authorization: string | null } = { ids: [], authorization: null };
  server.use(
    http.get(STAFF, ({ params, request }) => {
      const id = String(params.staffId);
      seen.ids.push(id);
      seen.authorization = request.headers.get("authorization");
      if (id === BOB) {
        return HttpResponse.json(
          {
            success: false,
            message: "Yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "AUTHORIZATION",
            requestId: "rid-403",
            path: `/admin/staff/${id}`,
            timeStamp: "2026-09-11T13:00:00.000000000Z",
          },
          { status: 403 },
        );
      }
      const body =
        id === NAMELESS
          ? member(id, null, "isimsiz@koala.local")
          : member(id, "Ayşe Kaya", "ayse@koala.local");
      return HttpResponse.json({
        success: true,
        message: "Personel getirildi.",
        httpStatus: "200 OK",
        path: `/admin/staff/${id}`,
        requestId: "rid-staff",
        timeStamp: "2026-09-11T13:00:00.000000000Z",
        data: body,
      });
    }),
  );
  return seen;
}

const withRead = { has: (permission: string) => permission === "staff.read" };
const withoutRead = { has: () => false };

afterEach(() => {
  vi.restoreAllMocks();
});

describe("resolveStaffRefs", () => {
  it("resolves a name and links to the staff row, once per distinct id", async () => {
    const seen = watchStaff();

    const refs = await resolveStaffRefs([ALICE, ALICE, null, undefined, ""], {
      accessToken: "ACCESS-TOKEN",
      context: withRead,
    });

    expect(seen.ids).toEqual([ALICE]);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(refs[ALICE]).toEqual({
      id: ALICE,
      label: "Ayşe Kaya",
      href: `/staff?ara=ayse%40koala.local#personel-${ALICE}`,
      resolved: true,
    });
  });

  it("falls back to the email when the member has no display name", async () => {
    watchStaff();

    const refs = await resolveStaffRefs([NAMELESS], {
      accessToken: "ACCESS-TOKEN",
      context: withRead,
    });

    expect(refs[NAMELESS]?.label).toBe("isimsiz@koala.local");
    expect(refs[NAMELESS]?.resolved).toBe(true);
  });

  it("keeps the page up when one lookup fails: that id shows its short form, still linked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const seen = watchStaff();

    const refs = await resolveStaffRefs([ALICE, BOB], {
      accessToken: "ACCESS-TOKEN",
      context: withRead,
    });

    expect(seen.ids.sort()).toEqual([ALICE, BOB].sort());
    expect(refs[ALICE]?.label).toBe("Ayşe Kaya");
    expect(refs[BOB]).toEqual({
      id: BOB,
      label: "5f000000",
      href: `/staff#personel-${BOB}`,
      resolved: false,
    });
  });

  it("never asks the backend without staff.read and links nowhere", async () => {
    const seen = watchStaff();

    const refs = await resolveStaffRefs([ALICE], {
      accessToken: "ACCESS-TOKEN",
      context: withoutRead,
    });

    expect(seen.ids).toEqual([]);
    expect(refs[ALICE]).toEqual({ id: ALICE, label: "5f000000", href: null, resolved: false });
  });

  it("does not send a non-UUID id to the backend", async () => {
    const seen = watchStaff();

    const refs = await resolveStaffRefs(["sistem"], {
      accessToken: "ACCESS-TOKEN",
      context: withRead,
    });

    expect(seen.ids).toEqual([]);
    expect(refs.sistem).toEqual({ id: "sistem", label: "sistem", href: null, resolved: false });
  });
});

describe("staffRefFor", () => {
  it("answers with the short id for an id that was never resolved", () => {
    expect(staffRefFor({}, ALICE)).toEqual({
      id: ALICE,
      label: "5f000000",
      href: null,
      resolved: false,
    });
  });
});

describe("staffMemberHref", () => {
  it("anchors the staff row and pre-filters by email when it is known", () => {
    expect(staffMemberHref(ALICE)).toBe(`/staff#personel-${ALICE}`);
    expect(staffMemberHref(ALICE, "a+b@koala.local")).toBe(
      `/staff?ara=a%2Bb%40koala.local#personel-${ALICE}`,
    );
  });
});
