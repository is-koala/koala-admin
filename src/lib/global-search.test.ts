import { describe, expect, it } from "vitest";

import { GLOBAL_SEARCH_DEFAULT_COOLDOWN_MS, parseGlobalSearchResponse } from "./global-search";

/**
 * Paletin `fetch` gövdesine güvenmediği yer. Özellikle `rate-limited`: bozuk
 * bir `retryAfterMs` sıfır beklemeye, sıfır bekleme de 429'a 429 ile cevap
 * veren bir döngüye dönüşürdü.
 */
describe("parseGlobalSearchResponse", () => {
  it("passes a well-formed response through", () => {
    expect(parseGlobalSearchResponse({ kind: "not-found", probed: ["user"] })).toEqual({
      kind: "not-found",
      probed: ["user"],
    });
    expect(parseGlobalSearchResponse({ kind: "rate-limited", retryAfterMs: 2500 })).toEqual({
      kind: "rate-limited",
      retryAfterMs: 2500,
    });
  });

  it("rejects anything that is not one of the contract's kinds", () => {
    expect(parseGlobalSearchResponse(null)).toBeNull();
    expect(parseGlobalSearchResponse("groups")).toBeNull();
    expect(parseGlobalSearchResponse({})).toBeNull();
    expect(parseGlobalSearchResponse({ kind: "surprise" })).toBeNull();
  });

  it("falls back to the default cooldown when retryAfterMs is missing, non-numeric or non-positive", () => {
    for (const retryAfterMs of [undefined, null, "soon", Number.NaN, Infinity, 0, -5]) {
      expect(parseGlobalSearchResponse({ kind: "rate-limited", retryAfterMs })).toEqual({
        kind: "rate-limited",
        retryAfterMs: GLOBAL_SEARCH_DEFAULT_COOLDOWN_MS,
      });
    }
  });
});
