import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { ACCOUNT_DELETIONS_PATH, DELETION_PAGING, getAccountDeletions } from "./account-deletions";
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
