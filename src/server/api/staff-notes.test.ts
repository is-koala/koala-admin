import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { envelope, pageEnvelope } from "../../../test/fixtures/admin-detail";
import { apiUrl, server } from "../../../test/msw";

import {
  FLAGS_PATH,
  NOTES_PATH,
  clearStaffFlag,
  createStaffNote,
  deleteStaffNote,
  getStaffFlags,
  getStaffFlagsByResource,
  getStaffNotes,
  setStaffFlag,
  updateStaffNote,
} from "./staff-notes";

const NOTES = apiUrl(NOTES_PATH);
const FLAGS = apiUrl(FLAGS_PATH);
const NOTE_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const USER_TWO = "bbbbbbbb-0000-4000-8000-000000000002";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function filledNote(overrides: Record<string, unknown> = {}) {
  return {
    id: NOTE_ID,
    resourceType: "USER",
    resourceId: USER_ID,
    authorStaffId: "s-1",
    authorDisplayName: "Destek",
    body: "Bu kullanıcıyla konuştuk.",
    createdAt: "2026-09-15T10:00:00.000000000Z",
    editedAt: null,
    ...overrides,
  };
}

function filledFlag(overrides: Record<string, unknown> = {}) {
  return {
    id: "f-1",
    resourceType: "USER",
    resourceId: USER_ID,
    kind: "RISK",
    label: "Sahte IBAN denemesi",
    setByStaffId: "s-2",
    setByDisplayName: "Trust",
    setAt: "2026-09-15T11:00:00.000000000Z",
    clearedAt: null,
    ...overrides,
  };
}

function watchNotesGet(content: unknown[] = [filledNote()]) {
  const seen = { url: null as URL | null, authorization: null as string | null, calls: 0 };
  server.use(
    http.get(NOTES, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(pageEnvelope(NOTES_PATH, content));
    }),
  );
  return seen;
}

describe("listing notes", () => {
  it("asks the backend for the resource pair, page, size and createdAt sort", async () => {
    const seen = watchNotesGet();

    await getStaffNotes("ACCESS-TOKEN", "USER", USER_ID);

    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(seen.url?.searchParams.get("resourceType")).toBe("USER");
    expect(seen.url?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(seen.url?.searchParams.get("page")).toBe("0");
    expect(seen.url?.searchParams.get("size")).toBe("20");
    expect(seen.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("returns the filled page the backend sent", async () => {
    watchNotesGet([filledNote()]);

    const page = await getStaffNotes("ACCESS-TOKEN", "USER", USER_ID);

    expect(page.content).toHaveLength(1);
    expect(page.content[0]?.body).toBe("Bu kullanıcıyla konuştuk.");
    expect(page.content[0]?.authorDisplayName).toBe("Destek");
  });

  it("tolerates a missing author name and editedAt from an older server", async () => {
    watchNotesGet([
      {
        id: NOTE_ID,
        resourceType: "USER",
        resourceId: USER_ID,
        authorStaffId: "s-1",
        body: "Eski sunucu.",
        createdAt: "2026-09-15T10:00:00Z",
      },
    ]);

    const page = await getStaffNotes("ACCESS-TOKEN", "USER", USER_ID);

    expect(page.content[0]?.authorDisplayName).toBeNull();
    expect(page.content[0]?.editedAt).toBeNull();
  });
});

describe("writing notes", () => {
  it("POSTs the body with the resource query and returns the created note", async () => {
    const seen = { url: null as URL | null, body: null as unknown };
    server.use(
      http.post(NOTES, async ({ request }) => {
        seen.url = new URL(request.url);
        seen.body = await request.json();
        return HttpResponse.json(envelope(NOTES_PATH, filledNote()), { status: 201 });
      }),
    );

    const note = await createStaffNote(
      "ACCESS-TOKEN",
      "USER",
      USER_ID,
      "Bu kullanıcıyla konuştuk.",
    );

    expect(seen.url?.searchParams.get("resourceType")).toBe("USER");
    expect(seen.url?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(seen.body).toEqual({ body: "Bu kullanıcıyla konuştuk." });
    expect(note.id).toBe(NOTE_ID);
  });

  it("PATCHes only the note id and body", async () => {
    const seen = { path: "", body: null as unknown };
    server.use(
      http.patch(apiUrl(`${NOTES_PATH}/${NOTE_ID}`), async ({ request }) => {
        seen.path = new URL(request.url).pathname;
        seen.body = await request.json();
        return HttpResponse.json(
          envelope(`${NOTES_PATH}/${NOTE_ID}`, filledNote({ body: "Düzeltildi." })),
        );
      }),
    );

    const note = await updateStaffNote("ACCESS-TOKEN", NOTE_ID, "Düzeltildi.");

    expect(seen.path).toBe(`${NOTES_PATH}/${NOTE_ID}`);
    expect(seen.body).toEqual({ body: "Düzeltildi." });
    expect(note.body).toBe("Düzeltildi.");
  });

  it("DELETEs without inventing a data payload", async () => {
    const seen = { calls: 0 };
    server.use(
      http.delete(apiUrl(`${NOTES_PATH}/${NOTE_ID}`), () => {
        seen.calls += 1;
        return HttpResponse.json({
          success: true,
          message: "Not silindi.",
          httpStatus: "200 OK",
          path: `${NOTES_PATH}/${NOTE_ID}`,
          requestId: "rid-del",
          timeStamp: "2026-09-15T12:00:00.000000000Z",
        });
      }),
    );

    await deleteStaffNote("ACCESS-TOKEN", NOTE_ID);
    expect(seen.calls).toBe(1);
  });
});

describe("listing flags", () => {
  it("sends a single resourceId for the object page", async () => {
    const seen = { url: null as URL | null };
    server.use(
      http.get(FLAGS, ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(envelope(FLAGS_PATH, [filledFlag()]));
      }),
    );

    const flags = await getStaffFlags("ACCESS-TOKEN", {
      resourceType: "USER",
      resourceId: USER_ID,
    });

    expect(seen.url?.searchParams.get("resourceType")).toBe("USER");
    expect(seen.url?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(seen.url?.searchParams.get("resourceIds")).toBeNull();
    expect(flags[0]?.kind).toBe("RISK");
  });

  it("sends resourceIds as a comma list for list badges", async () => {
    const seen = { url: null as URL | null, calls: 0 };
    server.use(
      http.get(FLAGS, ({ request }) => {
        seen.calls += 1;
        seen.url = new URL(request.url);
        return HttpResponse.json(
          envelope(FLAGS_PATH, [
            filledFlag(),
            filledFlag({ id: "f-2", resourceId: USER_TWO, kind: "VIP", label: null }),
          ]),
        );
      }),
    );

    const grouped = await getStaffFlagsByResource("ACCESS-TOKEN", "USER", [USER_ID, USER_TWO]);

    expect(seen.url?.searchParams.get("resourceIds")).toBe(`${USER_ID},${USER_TWO}`);
    expect(grouped.get(USER_ID)?.[0]?.kind).toBe("RISK");
    expect(grouped.get(USER_TWO)?.[0]?.kind).toBe("VIP");
    expect(seen.calls).toBe(1);
  });

  it("does not call the backend for an empty id list", async () => {
    const seen = { calls: 0 };
    server.use(
      http.get(FLAGS, () => {
        seen.calls += 1;
        return HttpResponse.json(envelope(FLAGS_PATH, []));
      }),
    );

    const grouped = await getStaffFlagsByResource("ACCESS-TOKEN", "USER", []);
    expect(seen.calls).toBe(0);
    expect(grouped.size).toBe(0);
  });

  it("tolerates a missing label and display name", async () => {
    server.use(
      http.get(FLAGS, () =>
        HttpResponse.json(
          envelope(FLAGS_PATH, [
            {
              id: "f-3",
              resourceType: "JOB",
              resourceId: USER_ID,
              kind: "WATCH",
              setAt: "2026-09-15T11:00:00Z",
            },
          ]),
        ),
      ),
    );

    const flags = await getStaffFlags("ACCESS-TOKEN", { resourceType: "JOB", resourceId: USER_ID });

    expect(flags[0]?.label).toBeNull();
    expect(flags[0]?.setByDisplayName).toBeNull();
    expect(flags[0]?.clearedAt).toBeNull();
  });
});

describe("writing flags", () => {
  it("PUTs kind and optional label", async () => {
    const seen = { url: null as URL | null, body: null as unknown };
    server.use(
      http.put(FLAGS, async ({ request }) => {
        seen.url = new URL(request.url);
        seen.body = await request.json();
        return HttpResponse.json(envelope(FLAGS_PATH, filledFlag()));
      }),
    );

    await setStaffFlag("ACCESS-TOKEN", "USER", USER_ID, "RISK", "Sahte IBAN denemesi");

    expect(seen.url?.searchParams.get("resourceType")).toBe("USER");
    expect(seen.url?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(seen.body).toEqual({ kind: "RISK", label: "Sahte IBAN denemesi" });
  });

  it("omits label when the operator left it empty", async () => {
    const seen = { body: null as unknown };
    server.use(
      http.put(FLAGS, async ({ request }) => {
        seen.body = await request.json();
        return HttpResponse.json(envelope(FLAGS_PATH, filledFlag({ label: null })));
      }),
    );

    await setStaffFlag("ACCESS-TOKEN", "USER", USER_ID, "VIP", null);
    expect(seen.body).toEqual({ kind: "VIP" });
  });

  it("DELETEs with resource and kind query", async () => {
    const seen = { url: null as URL | null };
    server.use(
      http.delete(FLAGS, ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json({
          success: true,
          message: "İşaret kaldırıldı.",
          httpStatus: "200 OK",
          path: FLAGS_PATH,
          requestId: "rid-clear",
          timeStamp: "2026-09-15T12:00:00.000000000Z",
        });
      }),
    );

    await clearStaffFlag("ACCESS-TOKEN", "USER", USER_ID, "RISK");

    expect(seen.url?.searchParams.get("resourceType")).toBe("USER");
    expect(seen.url?.searchParams.get("resourceId")).toBe(USER_ID);
    expect(seen.url?.searchParams.get("kind")).toBe("RISK");
  });
});
