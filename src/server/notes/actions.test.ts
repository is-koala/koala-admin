import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { envelope } from "../../../test/fixtures/admin-detail";
import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { INITIAL_STAFF_NOTES_FORM_STATE, STAFF_NOTES_FIELD } from "@/lib/staff-notes-form";
import { apiUrl, server } from "../../../test/msw";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const revalidatePath = vi.fn<(path: string) => void>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

vi.mock("next/cache", () => ({ revalidatePath }));

const {
  submitStaffFlagClear,
  submitStaffFlagSet,
  submitStaffNoteCreate,
  submitStaffNoteDelete,
  submitStaffNoteEdit,
} = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const NOTES = apiUrl("/admin/notes");
const FLAGS = apiUrl("/admin/flags");
const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  revalidatePath.mockReset();
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
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

const resource = {
  [STAFF_NOTES_FIELD.resourceType]: "USER",
  [STAFF_NOTES_FIELD.resourceId]: USER_ID,
};

describe("note writes refuse before they act", () => {
  it("will not create without note.write, and sends nothing", async () => {
    stubMe(["note.read", "user.read"]);
    const seen = { calls: 0 };
    server.use(
      http.post(NOTES, () => {
        seen.calls += 1;
        return HttpResponse.json(envelope("/admin/notes", { id: NOTE_ID }), { status: 201 });
      }),
    );

    const state = await submitStaffNoteCreate(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.body]: "Bu kullanıcıyla konuştuk." }),
    );

    expect(seen.calls).toBe(0);
    expect(state.outcome).toBe("error");
    expect(state.message).toContain("Personel notlarını yaz");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("will not create an empty body", async () => {
    stubMe(["note.write"]);
    const seen = { calls: 0 };
    server.use(
      http.post(NOTES, () => {
        seen.calls += 1;
        return HttpResponse.json(envelope("/admin/notes", { id: NOTE_ID }), { status: 201 });
      }),
    );

    const state = await submitStaffNoteCreate(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.body]: "   " }),
    );

    expect(seen.calls).toBe(0);
    expect(state.field).toBe("body");
  });

  it("POSTs through the BFF and revalidates the object page", async () => {
    stubMe(["note.write"]);
    const seen = { calls: 0, body: null as unknown };
    server.use(
      http.post(NOTES, async ({ request }) => {
        seen.calls += 1;
        seen.body = await request.json();
        return HttpResponse.json(
          envelope("/admin/notes", {
            id: NOTE_ID,
            resourceType: "USER",
            resourceId: USER_ID,
            authorStaffId: "s-1",
            authorDisplayName: "Destek",
            body: "Bu kullanıcıyla konuştuk.",
            createdAt: "2026-09-15T10:00:00Z",
            editedAt: null,
          }),
          { status: 201 },
        );
      }),
    );

    const state = await submitStaffNoteCreate(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.body]: "Bu kullanıcıyla konuştuk." }),
    );

    expect(seen.calls).toBe(1);
    expect(seen.body).toEqual({ body: "Bu kullanıcıyla konuştuk." });
    expect(state.outcome).toBe("success");
    expect(revalidatePath).toHaveBeenCalledWith(`/users/${USER_ID}`);
    expect(revalidatePath).toHaveBeenCalledWith("/users");
  });

  it("will not edit without note.write", async () => {
    stubMe(["note.read"]);
    const seen = { calls: 0 };
    server.use(
      http.patch(apiUrl(`/admin/notes/${NOTE_ID}`), () => {
        seen.calls += 1;
        return HttpResponse.json(envelope(`/admin/notes/${NOTE_ID}`, { id: NOTE_ID }));
      }),
    );

    const state = await submitStaffNoteEdit(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({
        ...resource,
        [STAFF_NOTES_FIELD.noteId]: NOTE_ID,
        [STAFF_NOTES_FIELD.body]: "Düzeltildi.",
      }),
    );

    expect(seen.calls).toBe(0);
    expect(state.outcome).toBe("error");
  });

  it("will not delete without note.write", async () => {
    stubMe(["user.read"]);
    const seen = { calls: 0 };
    server.use(
      http.delete(apiUrl(`/admin/notes/${NOTE_ID}`), () => {
        seen.calls += 1;
        return HttpResponse.json({ success: true, message: "ok", httpStatus: "200 OK" });
      }),
    );

    const state = await submitStaffNoteDelete(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.noteId]: NOTE_ID }),
    );

    expect(seen.calls).toBe(0);
    expect(state.outcome).toBe("error");
  });
});

describe("flag writes refuse before they act", () => {
  it("will not set a flag without flag.manage", async () => {
    stubMe(["note.read", "note.write"]);
    const seen = { calls: 0 };
    server.use(
      http.put(FLAGS, () => {
        seen.calls += 1;
        return HttpResponse.json(envelope("/admin/flags", { id: "f-1" }));
      }),
    );

    const state = await submitStaffFlagSet(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.kind]: "RISK" }),
    );

    expect(seen.calls).toBe(0);
    expect(state.message).toContain("İşaretleri yönet");
  });

  it("will not set an unknown kind", async () => {
    stubMe(["flag.manage"]);
    const seen = { calls: 0 };
    server.use(
      http.put(FLAGS, () => {
        seen.calls += 1;
        return HttpResponse.json(envelope("/admin/flags", { id: "f-1" }));
      }),
    );

    const state = await submitStaffFlagSet(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.kind]: "IMPERSONATION" }),
    );

    expect(seen.calls).toBe(0);
    expect(state.field).toBe("kind");
  });

  it("PUTs through the BFF for a TRUST_LEAD", async () => {
    stubMe(["flag.manage"]);
    const seen = { calls: 0, body: null as unknown };
    server.use(
      http.put(FLAGS, async ({ request }) => {
        seen.calls += 1;
        seen.body = await request.json();
        return HttpResponse.json(
          envelope("/admin/flags", {
            id: "f-1",
            resourceType: "USER",
            resourceId: USER_ID,
            kind: "VIP",
            label: null,
            setByStaffId: "s-2",
            setByDisplayName: "Trust",
            setAt: "2026-09-15T11:00:00Z",
            clearedAt: null,
          }),
        );
      }),
    );

    const state = await submitStaffFlagSet(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.kind]: "VIP" }),
    );

    expect(seen.calls).toBe(1);
    expect(seen.body).toEqual({ kind: "VIP" });
    expect(state.outcome).toBe("success");
    expect(revalidatePath).toHaveBeenCalledWith(`/users/${USER_ID}`);
  });

  it("will not clear without flag.manage", async () => {
    stubMe(["note.read"]);
    const seen = { calls: 0 };
    server.use(
      http.delete(FLAGS, () => {
        seen.calls += 1;
        return HttpResponse.json({ success: true, message: "ok", httpStatus: "200 OK" });
      }),
    );

    const state = await submitStaffFlagClear(
      INITIAL_STAFF_NOTES_FORM_STATE,
      form({ ...resource, [STAFF_NOTES_FIELD.kind]: "RISK" }),
    );

    expect(seen.calls).toBe(0);
    expect(state.outcome).toBe("error");
  });
});
