import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  ACCOUNT_DELETIONS_PATH,
  DELETION_PAGING,
  accountDeletionDetailPath,
  deletionBlockerLabel,
  getAccountDeletion,
  getAccountDeletions,
} from "./account-deletions";
import { readPaging } from "./paging";

/**
 * koala-backend#263: `query` talep sahibinin e-postasında arar; 2–100
 * karakter, kırpılmış, kısa değer süzmez. Kural `search-query.test.ts`'de;
 * burada bu kurucunun ona uyduğu ve durum süzgeciyle yan yana gönderdiği
 * sabitlenir.
 */

function watchQueue() {
  const seen: { url: URL | null } = { url: null };
  server.use(
    http.get(apiUrl(ACCOUNT_DELETIONS_PATH), ({ request }) => {
      seen.url = new URL(request.url);
      return HttpResponse.json({
        success: true,
        message: "Listelendi.",
        httpStatus: "200 OK",
        path: ACCOUNT_DELETIONS_PATH,
        requestId: "rid-deletions",
        timeStamp: "2026-09-14T08:00:00Z",
        data: {
          content: [],
          page: 0,
          size: 20,
          totalElements: 0,
          totalPages: 0,
          first: true,
          last: true,
        },
      });
    }),
  );
  return seen;
}

describe("the deletion queue search goes to the backend as query", () => {
  it("forwards a trimmed search next to the status filter", async () => {
    const seen = watchQueue();

    await getAccountDeletions("ACCESS-TOKEN", {
      status: "REQUESTED",
      paging: readPaging({}, DELETION_PAGING),
      query: "  ayse@example.com ",
    });

    expect(seen.url?.searchParams.get("query")).toBe("ayse@example.com");
    expect(seen.url?.searchParams.get("status")).toBe("REQUESTED");
    expect(seen.url?.searchParams.get("sort")).toBe("requestedAt,desc");
  });

  it("sends no query for one character, and clips at 100", async () => {
    const seen = watchQueue();

    await getAccountDeletions("ACCESS-TOKEN", {
      paging: readPaging({}, DELETION_PAGING),
      query: "a",
    });
    expect(seen.url?.searchParams.has("query")).toBe(false);
    expect(seen.url?.searchParams.has("status")).toBe(false);

    await getAccountDeletions("ACCESS-TOKEN", {
      paging: readPaging({}, DELETION_PAGING),
      query: "k".repeat(120),
    });
    expect(seen.url?.searchParams.get("query")).toHaveLength(100);
  });
});

/** koala-admin#100 / koala-backend#283: ret gerekçesi, reddeden personel, engelleyiciler. */
describe("rejection provenance and blockers", () => {
  const id = "aaaaaaaa-1111-4111-8111-111111111111";

  it("reads the three fields and keeps [] apart from an absent blocker list", async () => {
    let extra: Record<string, unknown> = {
      rejectionReason: "Açık hakediş var.",
      rejectedByStaffId: "5f000000-0000-4000-8000-000000000055",
      blockers: [{ type: "ESCROW", id: "9a1c0f10-0001-4c00-8000-0000000000aa" }],
    };
    server.use(
      http.get(apiUrl(accountDeletionDetailPath(id)), () =>
        HttpResponse.json({
          success: true,
          message: "Getirildi.",
          httpStatus: "200 OK",
          path: accountDeletionDetailPath(id),
          requestId: "rid-deletion",
          timeStamp: "2026-09-14T08:00:00Z",
          data: { id, subjectId: null, status: "REQUESTED", ...extra },
        }),
      ),
    );

    const detail = await getAccountDeletion("ACCESS-TOKEN", id);
    expect(detail.rejectionReason).toBe("Açık hakediş var.");
    expect(detail.rejectedByStaffId).toBe("5f000000-0000-4000-8000-000000000055");
    expect(detail.blockers).toEqual([
      { type: "ESCROW", id: "9a1c0f10-0001-4c00-8000-0000000000aa" },
    ]);

    extra = { blockers: [] };
    expect((await getAccountDeletion("ACCESS-TOKEN", id)).blockers).toEqual([]);

    extra = {};
    const legacy = await getAccountDeletion("ACCESS-TOKEN", id);
    expect(legacy.blockers).toBeNull();
    expect(legacy.rejectionReason).toBeNull();
    expect(legacy.rejectedByStaffId).toBeNull();
  });

  it("labels the four blocker types and shows an unknown one as its code", () => {
    expect(deletionBlockerLabel("PENDING_PAYMENT")).toBe("Bekleyen tahsilat");
    expect(deletionBlockerLabel("ESCROW")).toBe("Emanette para");
    expect(deletionBlockerLabel("ACTIVE_WORK")).toBe("Devam eden iş");
    expect(deletionBlockerLabel("DISPUTE")).toBe("Açık uyuşmazlık");
    expect(deletionBlockerLabel("FUTURE")).toBe("FUTURE");
  });
});
