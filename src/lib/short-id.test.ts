import { describe, expect, it } from "vitest";

import { shortId } from "./short-id";

describe("shortId", () => {
  it("keeps the first block of a UUID and leaves anything else alone", () => {
    expect(shortId("b7f4a2c1-0000-4c00-8000-000000000001")).toBe("b7f4a2c1");
    expect(shortId("KOALA-9F3A")).toBe("KOALA-9F3A");
    expect(shortId("abc")).toBe("abc");
  });
});
