import { describe, expect, it } from "vitest";

import { csvCell, csvDocument, csvFileName, csvLine } from "./csv";

describe("csv cells", () => {
  it("quotes every cell and doubles inner quotes", () => {
    expect(csvCell('Koala "Kafe"')).toBe('"Koala ""Kafe"""');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(12)).toBe('"12"');
    expect(csvCell(true)).toBe('"true"');
  });

  it("writes null and undefined as an empty cell rather than the word null", () => {
    expect(csvCell(null)).toBe('""');
    expect(csvCell(undefined)).toBe('""');
  });

  it("neutralises a cell a spreadsheet would run as a formula", () => {
    expect(csvCell('=HYPERLINK("http://x")')).toBe('"\'=HYPERLINK(""http://x"")"');
    expect(csvCell("+1 555")).toBe('"\'+1 555"');
    expect(csvCell("@ayse")).toBe('"\'@ayse"');
    // Tutarlar rakamla başlar; dokunulmaz.
    expect(csvCell("1240.50")).toBe('"1240.50"');
  });

  it("keeps a multi-line cell inside its quotes", () => {
    expect(csvLine(["a\nb", "c"])).toBe('"a\nb","c"');
  });
});

describe("csvDocument", () => {
  it("starts with a UTF-8 BOM and ends every line with CRLF", () => {
    const text = csvDocument(["Ad", "Tutar"], [["Ayşe", "1240.50"]]);

    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(text.slice(1)).toBe('"Ad","Tutar"\r\n"Ayşe","1240.50"\r\n');
  });

  it("writes only the header for an empty list", () => {
    expect(csvDocument(["Ad"], []).slice(1)).toBe('"Ad"\r\n');
  });
});

describe("csvFileName", () => {
  it("dates the file by the UTC day and keeps the stem ASCII", () => {
    expect(csvFileName("atamalar", new Date("2026-09-14T10:00:00Z"))).toBe(
      "atamalar-2026-09-14.csv",
    );
  });
});
