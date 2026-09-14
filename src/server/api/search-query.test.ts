import { describe, expect, it } from "vitest";

import { KoalaApiError } from "./errors";
import {
  SEARCH_QUERY_MAX_LENGTH,
  SEARCH_QUERY_TOO_LONG_CODE,
  isSearchQueryTooLong,
  readSearchQuery,
  searchQueryParam,
} from "./search-query";

/**
 * `StaffSearchQuery.java`'nın panel tarafındaki aynası. Kural tek yerde
 * (2–100, kırpılmış, kısa değer süzmez) ve yedi istek kurucu ona güvenir; bu
 * dosya kuralın kendisini sabitler, kurucular yalnız onu çağırdıklarını.
 */

describe("what the request carries as query", () => {
  it("sends nothing for an absent, blank or one-character search", () => {
    expect(searchQueryParam(null)).toBeUndefined();
    expect(searchQueryParam(undefined)).toBeUndefined();
    expect(searchQueryParam("")).toBeUndefined();
    expect(searchQueryParam("   ")).toBeUndefined();
    expect(searchQueryParam("a")).toBeUndefined();
    expect(searchQueryParam(" a ")).toBeUndefined();
  });

  it("trims and forwards two characters or more", () => {
    expect(searchQueryParam("ay")).toBe("ay");
    expect(searchQueryParam("  Ayşe Yılmaz  ")).toBe("Ayşe Yılmaz");
  });

  it("clips at 100 UTF-16 units — the same ruler as Java's String.length()", () => {
    const long = "ş".repeat(150);

    const sent = searchQueryParam(long);

    expect(sent).toHaveLength(SEARCH_QUERY_MAX_LENGTH);
    expect(sent).toBe("ş".repeat(100));
  });

  it("does not leave half a surrogate pair at the cut", () => {
    const sent = searchQueryParam(`${"a".repeat(99)}😀`);

    expect(sent).toBe("a".repeat(99));
  });

  it("keeps exactly 100 characters untouched", () => {
    const exact = "k".repeat(100);

    expect(searchQueryParam(exact)).toBe(exact);
  });
});

describe("what the page shows back in the box", () => {
  it("keeps a one-character search as typed so the box can explain it", () => {
    expect(readSearchQuery("a")).toBe("a");
    expect(readSearchQuery("  ayşe ")).toBe("ayşe");
  });

  it("treats blank as no search", () => {
    expect(readSearchQuery(null)).toBeNull();
    expect(readSearchQuery("   ")).toBeNull();
  });
});

describe("recognising the backend's refusal", () => {
  const tooLong = new KoalaApiError({
    status: 400,
    errorCode: SEARCH_QUERY_TOO_LONG_CODE,
    errorCategory: "VALIDATION_FAILED",
    message: "Arama metni en fazla 100 karakter olabilir.",
  });

  it("matches a 400 ADMIN_SEARCH_QUERY_TOO_LONG and nothing else", () => {
    expect(isSearchQueryTooLong(tooLong)).toBe(true);
    expect(
      isSearchQueryTooLong(
        new KoalaApiError({
          status: 400,
          errorCode: "VALIDATION_FAILED",
          errorCategory: "VALIDATION_FAILED",
          message: "Bilinmeyen sıralama alanı.",
        }),
      ),
    ).toBe(false);
    expect(isSearchQueryTooLong(new Error("network"))).toBe(false);
    expect(isSearchQueryTooLong(null)).toBe(false);
  });
});
