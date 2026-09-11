import { describe, expect, it } from "vitest";

import { isTurkishIban } from "./iban-verification";

describe("Turkish IBAN checksum matches the backend helper", () => {
  it("accepts the IBAN the backend IT uses", () => {
    expect(isTurkishIban("TR18 0006 2001 1900 0006 6723 15")).toBe(true);
    expect(isTurkishIban("TR180006200119000006672315")).toBe(true);
  });

  it("rejects a truncated or foreign number", () => {
    expect(isTurkishIban("TR18")).toBe(false);
    expect(isTurkishIban("DE89370400440532013000")).toBe(false);
    expect(isTurkishIban("TR00 0000 0000 0000 0000 0000 00")).toBe(false);
  });
});
