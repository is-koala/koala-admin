/**
 * CSV yazımı (koala-admin#110). Ağ yok, panel tipi yok: yalnız hücre metni.
 *
 * Kurallar Excel'in Türkçe kurulumunda dosyanın tek tıkla açılması için:
 * UTF-8 BOM (yoksa `Ayşe` bozuk çıkar), `\r\n` satır sonu, her hücre
 * tırnaklı ve içteki tırnak ikilenir (RFC 4180). Ayraç virgül: Türkçe
 * Excel noktalı virgül bekler ama `sep=` satırı BOM'la çakışır ve diğer
 * araçlar (Sheets, Numbers, pandas) virgülü varsayar; dosya "içe aktar"
 * ile her ikisinde de açılır.
 *
 * Formül enjeksiyonu: `=`, `+`, `-`, `@` ile başlayan bir hücreyi hesap
 * tablosu formül olarak çalıştırır — bir ilan başlığı `=HYPERLINK(...)` ise
 * personelin makinesinde açılır. Böyle hücrelerin başına `'` konur; sayı
 * gibi görünen tutarlar (`1240.50`) etkilenmez çünkü rakamla başlar. Negatif
 * sayı bu listelerde yok; olsaydı da `'-5` okunur, çalışmaz.
 */

const BOM = "\uFEFF";
const FORMULA_LEAD = /^[=+\-@\t\r]/;

export type CsvCell = string | number | boolean | null | undefined;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '""';
  let text = typeof value === "string" ? value : String(value);
  if (FORMULA_LEAD.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(csvCell).join(",");
}

/** Başlık + satırlar, BOM'lu ve `\r\n` ile biten tek metin. */
export function csvDocument(
  header: readonly string[],
  rows: readonly (readonly CsvCell[])[],
): string {
  const lines = [csvLine(header), ...rows.map((row) => csvLine(row))];
  return `${BOM}${lines.join("\r\n")}\r\n`;
}

/** `atamalar-2026-09-14.csv` — ad ASCII kalsın diye Türkçe karakter kullanılmaz. */
export function csvFileName(stem: string, at: Date = new Date()): string {
  return `${stem}-${at.toISOString().slice(0, 10)}.csv`;
}
