import { EXPORT_ROW_LIMIT, exportHref, type ExportList } from "@/lib/export";
import { formatInteger } from "@/lib/format";

/**
 * "CSV indir" (koala-admin#110). Bağlantı panelin kendi sunucu rotasına gider
 * (`/api/export/<liste>`), backend'e değil: token çerezde kalır, izin ve
 * satır tavanı rotada. Adres kuralı `@/lib/export`.
 *
 * Düz `<a>`, `next/link` değil: hedef bir sayfa değil dosya; `download`
 * özniteliği tarayıcıya bunu söyler ve istemci yönlendiricisi devreye girmez.
 */
export function CsvExportLink({
  list,
  state,
  unit,
}: {
  list: ExportList;
  state: Readonly<Record<string, string>>;
  /** Tekil ad: "atama", "hakediş". */
  unit: string;
}) {
  return (
    <p className="flex flex-wrap items-baseline gap-2 text-sm" data-testid={`${list}-export`}>
      <a
        href={exportHref(list, state)}
        download
        className="rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
      >
        CSV indir
      </a>
      <span className="text-xs text-ink-muted">
        Bu görünümün ilk {formatInteger(EXPORT_ROW_LIMIT)} {unit} satırı; indirme günlüğe yazılır.
      </span>
    </p>
  );
}
