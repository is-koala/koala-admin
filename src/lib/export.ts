/**
 * "CSV indir" adresi (koala-admin#110). JSX'siz: CSV rotasının gövdesi
 * (`src/server/export/csv-export.ts`) tavanı ve liste adını buradan okur,
 * `CsvExportLink` bileşeni bağlantıyı buradan kurar.
 *
 * Adres o anki görünümü — durum, arama, kimlik süzgeçleri, tarih aralığı,
 * sıralama — olduğu gibi taşır; `sayfa` ve `boyut` taşınmaz çünkü dışa
 * aktarma ilk sayfa değil ilk N satırdır.
 */
export const EXPORT_ROW_LIMIT = 1000;

export type ExportList = "assignments" | "payouts" | "reports" | "disputes";

const NOT_CARRIED = new Set(["sayfa", "boyut"]);

export function exportHref(list: ExportList, state: Readonly<Record<string, string>>): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(state)) {
    if (!NOT_CARRIED.has(name) && value.length > 0) query.set(name, value);
  }
  const encoded = query.toString();
  return `/api/export/${list}${encoded.length > 0 ? `?${encoded}` : ""}`;
}
