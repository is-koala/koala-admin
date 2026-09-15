import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { envelope, pageEnvelope } from "../../../test/fixtures/admin-detail";
import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { StaffNotesSection } = await import("./staff-notes");

const ADMIN_ME = apiUrl("/admin/me");
const NOTES = apiUrl("/admin/notes");
const FLAGS = apiUrl("/admin/flags");
const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const STAFF_ID = "b7f4a2c1-0000-4c00-8000-000000000001";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: {
          ...adminMeSuccessBody.data,
          staffId: STAFF_ID,
          permissions: [...permissions],
        },
      }),
    ),
  );
}

function watchNotes(content: unknown[] = []) {
  const seen = { calls: 0, url: null as URL | null };
  server.use(
    http.get(NOTES, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      return HttpResponse.json(pageEnvelope("/admin/notes", content));
    }),
  );
  return seen;
}

function watchFlags(flags: unknown[] = []) {
  const seen = { calls: 0 };
  server.use(
    http.get(FLAGS, () => {
      seen.calls += 1;
      return HttpResponse.json(envelope("/admin/flags", flags));
    }),
  );
  return seen;
}

const renderSection = () =>
  renderServerComponent(<StaffNotesSection resourceType="USER" resourceId={USER_ID} />);

describe("the notes section on an object page", () => {
  it("does not fetch without note.read", async () => {
    stubMe(["user.read"]);
    const notes = watchNotes();
    const flags = watchFlags();

    const html = await renderSection();

    expect(notes.calls).toBe(0);
    expect(flags.calls).toBe(0);
    expect(html).toContain('data-testid="staff-notes-disabled"');
    expect(html).toContain("note.read");
    expect(html).not.toContain("Bu kullanıcıyla konuştuk.");
  });

  it("shows an empty state when the backend has no notes", async () => {
    stubMe(["note.read"]);
    watchNotes([]);
    watchFlags([]);

    const html = await renderSection();

    expect(html).toContain('data-testid="staff-notes-empty"');
    expect(html).toContain("Bu kayıt için personel notu yok.");
    expect(html).toContain("Bu kayıtta etkin işaret yok.");
    expect(html).toContain('data-testid="staff-notes-write-disabled"');
    expect(html).toContain('data-testid="staff-flags-manage-disabled"');
  });

  it("renders filled notes and flags, and write forms only with the matching permission", async () => {
    stubMe(["note.read", "note.write", "flag.manage"]);
    const notes = watchNotes([
      {
        id: NOTE_ID,
        resourceType: "USER",
        resourceId: USER_ID,
        authorStaffId: STAFF_ID,
        authorDisplayName: "Destek",
        body: "Bu kullanıcıyla konuştuk.",
        createdAt: "2026-09-15T10:00:00Z",
        editedAt: null,
      },
    ]);
    watchFlags([
      {
        id: "f-1",
        resourceType: "USER",
        resourceId: USER_ID,
        kind: "RISK",
        label: "Sahte IBAN",
        setByStaffId: "s-2",
        setByDisplayName: "Trust",
        setAt: "2026-09-15T11:00:00Z",
        clearedAt: null,
      },
    ]);

    const html = await renderSection();

    expect(notes.url?.searchParams.get("resourceType")).toBe("USER");
    expect(notes.url?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(html).toContain("Bu kullanıcıyla konuştuk.");
    expect(html).toContain("Destek");
    expect(html).toContain("Riskli");
    expect(html).toContain("Sahte IBAN");
    expect(html).toContain('data-testid="staff-note-compose"');
    expect(html).toContain('data-testid="staff-flag-set"');
    expect(html).toContain(`data-testid="staff-note-edit-${NOTE_ID}"`);
    expect(html).not.toContain('data-testid="staff-notes-disabled"');
  });

  it("hides edit on someone else's note unless staff.manage is held", async () => {
    stubMe(["note.read", "note.write"]);
    watchNotes([
      {
        id: NOTE_ID,
        resourceType: "USER",
        resourceId: USER_ID,
        authorStaffId: "other-staff",
        authorDisplayName: "Başka",
        body: "Başkasının notu.",
        createdAt: "2026-09-15T10:00:00Z",
        editedAt: null,
      },
    ]);
    watchFlags([]);

    const html = await renderSection();

    expect(html).toContain("Başkasının notu.");
    expect(html).toContain('data-testid="staff-note-compose"');
    expect(html).not.toContain(`data-testid="staff-note-edit-${NOTE_ID}"`);
  });
});
