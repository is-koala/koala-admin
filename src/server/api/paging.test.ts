import { describe, expect, it } from "vitest";

import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  firstPage,
  pageWindow,
  pagingQuery,
  parseSort,
  readBooleanParam,
  readEnumListParam,
  readEnumParam,
  readPaging,
  readParam,
  readUuidParam,
  sortParam,
  type PagingContract,
} from "./paging";

/**
 * The rule these tests exist to hold: **a filter is a query parameter.**
 *
 * The failure this prevents is not a crash. It is a queue that looks right —
 * twenty rows, a sort control, a page number — while the sort only ever
 * reordered the twenty rows the server happened to send. Nothing about that
 * screen looks broken to the operator using it.
 */

const REPORTS: PagingContract = {
  // `ReportManager.SORTABLE`, verbatim.
  sortable: ["createdAt", "status"],
  defaultSort: { field: "createdAt", direction: "desc" },
};

describe("reading a page request out of a URL", () => {
  it("defaults to the first page, the backend's page size and its default sort", () => {
    expect(readPaging({}, REPORTS)).toEqual({
      page: 0,
      size: DEFAULT_PAGE_SIZE,
      sort: { field: "createdAt", direction: "desc" },
    });
  });

  it("takes the page, size and sort the operator asked for", () => {
    const paging = readPaging({ sayfa: "3", boyut: "50", sirala: "status,asc" }, REPORTS);

    expect(paging).toEqual({ page: 3, size: 50, sort: { field: "status", direction: "asc" } });
  });

  it("clamps a size above the backend's own ceiling", () => {
    // PageableSanitizer caps at 100 silently. Sending 5000 would leave the URL
    // claiming a page size the response does not have.
    expect(readPaging({ boyut: "5000" }, REPORTS).size).toBe(MAX_PAGE_SIZE);
  });

  it("refuses a negative page rather than letting PageRequest.of throw", () => {
    expect(readPaging({ sayfa: "-4" }, REPORTS).page).toBe(0);
  });

  it("ignores junk in place of numbers", () => {
    expect(readPaging({ sayfa: "abc", boyut: "" }, REPORTS)).toEqual({
      page: 0,
      size: DEFAULT_PAGE_SIZE,
      sort: { field: "createdAt", direction: "desc" },
    });
  });

  it("drops a sort field the endpoint does not sort on", () => {
    // `rejectUnknownSort` throws before `sanitize` gets a chance to drop it, so
    // an unfiltered `?sirala=email` is a 400 and an empty screen.
    expect(parseSort("email,asc", REPORTS)).toEqual({ field: "createdAt", direction: "desc" });
    expect(readPaging({ sirala: "email,asc" }, REPORTS).sort.field).toBe("createdAt");
  });

  it("treats any direction that is not asc as desc", () => {
    expect(parseSort("createdAt,sideways", REPORTS).direction).toBe("desc");
  });

  it("takes the first value when a key is repeated", () => {
    expect(readParam({ durum: ["OPEN", "ACTIONED"] }, "durum")).toBe("OPEN");
  });

  it("falls back when a closed-set value is not in the set", () => {
    // Spring answers an unbindable enum with 400; a bookmark must not do that.
    expect(readEnumParam({ durum: "muz" }, "durum", ["OPEN", "ACTIONED"], "OPEN")).toBe("OPEN");
    expect(readEnumParam({ durum: "ACTIONED" }, "durum", ["OPEN", "ACTIONED"], "OPEN")).toBe(
      "ACTIONED",
    );
  });

  it("reads a boolean as exactly true or not true", () => {
    expect(readBooleanParam({ onayli: "true" }, "onayli", false)).toBe(true);
    expect(readBooleanParam({ onayli: "1" }, "onayli", false)).toBe(false);
    expect(readBooleanParam({}, "onayli", false)).toBe(false);
  });
});

/** koala-admin#103: satır içi listeler URL'siz sayfalar; sınırlar yine geçerli. */
describe("firstPage", () => {
  it("is page zero with the contract's default sort and the asked size", () => {
    expect(firstPage(REPORTS, 10)).toEqual({
      page: 0,
      size: 10,
      sort: { field: "createdAt", direction: "desc" },
    });
  });

  it("clamps the size to what the backend accepts", () => {
    expect(firstPage(REPORTS, 5000).size).toBe(MAX_PAGE_SIZE);
    expect(firstPage(REPORTS, 0).size).toBe(1);
    expect(firstPage(REPORTS, 7.9).size).toBe(7);
  });
});

describe("what actually goes on the wire", () => {
  it("turns the panel's Turkish URL into the backend's Pageable parameters", () => {
    const query = pagingQuery(
      readPaging({ sayfa: "2", boyut: "25", sirala: "status,asc" }, REPORTS),
    );

    expect(query).toEqual({ page: 2, size: 25, sort: "status,asc" });
  });

  it("writes the sort the way Spring parses it", () => {
    expect(sortParam({ field: "createdAt", direction: "desc" })).toBe("createdAt,desc");
  });
});

describe("the window a pager draws from", () => {
  it("carries only the page metadata, never the rows", () => {
    const window = pageWindow({
      content: [{ id: "a" }, { id: "b" }],
      page: 1,
      size: 20,
      totalElements: 41,
      totalPages: 3,
      first: false,
      last: false,
    });

    expect(window).toEqual({
      page: 1,
      size: 20,
      totalElements: 41,
      totalPages: 3,
      first: false,
      last: false,
    });
    expect(window).not.toHaveProperty("content");
  });
});

/** koala-admin#100: beş liste sayfasının ortak kimlik süzgeci okuyucusu. */
describe("readUuidParam", () => {
  it("returns a trimmed UUID and null for anything Spring could not bind", () => {
    expect(readUuidParam({ isci: " aaaaaaaa-0000-4000-8000-000000000001 " }, "isci")).toBe(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
    expect(readUuidParam({ isci: "not-a-uuid" }, "isci")).toBeNull();
    expect(readUuidParam({}, "isci")).toBeNull();
    expect(readUuidParam({ isci: ["aaaaaaaa-0000-4000-8000-000000000001", "x"] }, "isci")).toBe(
      "aaaaaaaa-0000-4000-8000-000000000001",
    );
  });
});

describe("readEnumListParam — koala-admin#110", () => {
  it("accepts a repeated key and a comma list alike, in the catalogue's order", () => {
    const allowed = ["A", "B", "C"] as const;
    expect(readEnumListParam({ durum: ["C", "A"] }, "durum", allowed)).toEqual(["A", "C"]);
    expect(readEnumListParam({ durum: "C,A" }, "durum", allowed)).toEqual(["A", "C"]);
    expect(readEnumListParam({ durum: ["B", "B,A"] }, "durum", allowed)).toEqual(["A", "B"]);
  });

  it("drops unknown values silently and returns an empty list when nothing is set", () => {
    const allowed = ["A", "B"] as const;
    expect(readEnumListParam({ durum: "banana,B" }, "durum", allowed)).toEqual(["B"]);
    expect(readEnumListParam({}, "durum", allowed)).toEqual([]);
    expect(readEnumListParam({ durum: "" }, "durum", allowed)).toEqual([]);
  });
});
