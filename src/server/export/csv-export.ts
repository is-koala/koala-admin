import "server-only";

import { csvDocument, csvFileName, type CsvCell } from "@/lib/csv";
import { istanbulDay } from "@/lib/date-range";
import { EXPORT_ROW_LIMIT, type ExportList } from "@/lib/export";
import { isKoalaApiError } from "@/server/api/errors";
import { MAX_PAGE_SIZE, type Paging, type SearchParams } from "@/server/api/paging";
import { isSearchQueryTooLong } from "@/server/api/search-query";
import type { PageDto } from "@/server/api/types";
import { isStaffAuthError } from "@/server/auth/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { getStaffContext, type StaffContextFailureKind } from "@/server/authz/staff-context";

/**
 * "CSV indir" rotalarının ortak gövdesi (koala-admin#110).
 *
 * Dört liste dört rota (`/api/export/<liste>`), çünkü her birinin kapısı
 * ayrı: rota kayıt defteri (`routes.ts`) yol başına tek izin ister ve dinamik
 * bir `[liste]` parçası o iddiayı yazılı tutamazdı. Gövde burada; rota
 * dosyası yalnız "hangi liste, hangi izin, hangi sütunlar" der.
 *
 * Kapı iki katlı. Oturum ve izin `/admin/me`'den (`getStaffContext`); izni
 * olmayan personel backend'e tek istek çıkmadan 403 alır — sayfa kapısıyla
 * aynı kural, `<RequirePermission>`'ın rota karşılığı. Backend yine de kendi
 * `@RequiresPermission`'ını uygular; burası yalnız gereksiz isteği önler.
 *
 * Satır tavanı `EXPORT_ROW_LIMIT`: backend sayfa başına en çok 100 verir
 * (`PageableSanitizer`), rota tavana ya da son sayfaya kadar sayfalar ve
 * sonuncu sayfayı kırpar. "İlk 1000" sıralama backend'inkidir — adresteki
 * `sirala` sayfayla aynı şekilde okunur, panelde yeniden sıralanmaz.
 *
 * Sütun izinleri: ad-soyad sütunları `user.read` ister — `SafeUserDto`
 * depo tanımıyla PII'sizdir ve diğer listeler adı aynı izinle gösterir;
 * kimlik sütunları herkese. `pii: true` gerçek PII (e-posta, telefon) için
 * `user.read_pii` kapısıdır; bugünkü liste DTO'larında böyle alan yok,
 * altyapı bir gün gelirse diye durur.
 *
 * Denetim: backend'de "export" diye bir eylem henüz yok (koala-backend#311
 * açık) — liste GET'inin izin kontrolü backend denetim kaydına kendi
 * satırını yazar, ama o satır sayfa mı dışa aktarma mı ayırmaz. Rota bu
 * yüzden tek satırlık yapılandırılmış bir günlük yazar
 * (`[koala-admin] audit action=export …`): kim, hangi liste, hangi süzgeç,
 * kaç satır, PII açık mı. #311 gelince bu satır backend'e taşınır.
 */

export interface ExportColumn<Row> {
  readonly header: string;
  readonly cell: (row: Row) => CsvCell;
  /** Sütun yalnız bu izin varken yazılır (ad-soyad: `user.read`). */
  readonly requires?: Permission;
  /** Gerçek PII: yalnız `user.read_pii` varken yazılır. */
  readonly pii?: boolean;
}

/** Bir listenin görünümü: en az sayfalama; kalanı listeye özgü. */
export interface ExportView {
  readonly paging: Paging;
}

export interface ExportSpec<Row, View extends ExportView> {
  readonly list: ExportList;
  readonly permission: Permission;
  /** Dosya adının ASCII gövdesi: `atamalar-2026-09-14.csv`. */
  readonly fileStem: string;
  /** Backend'in bu uç için sayfa tavanı; hakediş ucu 50 (PageableSanitizer yok). */
  readonly pageSize?: number;
  readonly columns: readonly ExportColumn<Row>[];
  /** Adres bir kez okunur; sayfayla aynı okuyucu (`src/server/lists/*`). */
  readonly readView: (params: SearchParams) => View;
  /** Görünümün adres anahtarları; günlük satırındaki süzgeç özeti. */
  readonly viewState: (view: View) => Readonly<Record<string, string>>;
  /** Bir sayfa; `paging` görünümün sıralamasıyla rotanın seçtiği sayfa/boyuttur. */
  readonly fetchPage: (accessToken: string, view: View, paging: Paging) => Promise<PageDto<Row>>;
}

const HEADERS = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
} as const;

const FAILURE_STATUS: Record<StaffContextFailureKind, number> = {
  SESSION: 401,
  NO_STAFF_RECORD: 403,
  BACKEND_UNAVAILABLE: 502,
  UNEXPECTED: 502,
};

export async function exportCsv<Row, View extends ExportView>(
  request: Request,
  spec: ExportSpec<Row, View>,
): Promise<Response> {
  const context = await getStaffContext();
  if (context.failure !== null) {
    return refuse(FAILURE_STATUS[context.failure.kind], "Dışa aktarma için oturum doğrulanamadı.");
  }
  if (!context.has(spec.permission)) {
    return refuse(403, "Bu dışa aktarma için yetkiniz yok.");
  }

  const showPii = context.has("user.read_pii");
  const columns = spec.columns.filter(
    (column) =>
      (column.requires === undefined || context.has(column.requires)) &&
      (column.pii !== true || showPii),
  );
  const size = Math.min(MAX_PAGE_SIZE, spec.pageSize ?? MAX_PAGE_SIZE);
  const view = spec.readView(searchParamsOf(new URL(request.url)));

  let rows: Row[];
  try {
    const accessToken = await getKoalaAccessToken();
    rows = await collectRows(size, (page) =>
      spec.fetchPage(accessToken, view, { ...view.paging, page, size }),
    );
  } catch (error) {
    if (isStaffAuthError(error)) return refuse(401, "Dışa aktarma için oturum doğrulanamadı.");
    if (isSearchQueryTooLong(error)) return refuse(400, "Arama metni backend'in sınırını aşıyor.");
    if (isKoalaApiError(error) && error.isForbidden) {
      return refuse(403, "Backend bu listeyi vermedi.");
    }
    return refuse(502, "Liste backend'den okunamadı; CSV üretilmedi.");
  }

  const body = csvDocument(
    columns.map((column) => column.header),
    rows.map((row) => columns.map((column) => column.cell(row))),
  );

  logExport({
    list: spec.list,
    staffId: context.staff?.staffId ?? null,
    rows: rows.length,
    pii: showPii,
    filters: spec.viewState(view),
    sort: view.paging.sort,
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(spec.fileStem, istanbulDay())}"`,
    },
  });
}

/**
 * Tavana ya da son sayfaya kadar sayfalar. `last` backend'in cevabıdır;
 * boş `content` de durdurur ki bozuk bir `last=false` sonsuz döngü olmasın.
 */
async function collectRows<Row>(
  size: number,
  fetchPage: (page: number) => Promise<PageDto<Row>>,
): Promise<Row[]> {
  const rows: Row[] = [];
  const maxPages = Math.ceil(EXPORT_ROW_LIMIT / size);
  for (let page = 0; page < maxPages && rows.length < EXPORT_ROW_LIMIT; page += 1) {
    const result = await fetchPage(page);
    rows.push(...result.content);
    if (result.last || result.content.length === 0) break;
  }
  return rows.slice(0, EXPORT_ROW_LIMIT);
}

/** Next'in `searchParams` biçimi: tekrar eden anahtar dizi olur. */
function searchParamsOf(url: URL): SearchParams {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of url.searchParams) {
    const previous = out[key];
    out[key] =
      previous === undefined
        ? value
        : Array.isArray(previous)
          ? [...previous, value]
          : [previous, value];
  }
  return out;
}

function refuse(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: { ...HEADERS, "Content-Type": "text/plain; charset=utf-8" },
  });
}

export const EXPORT_AUDIT_PREFIX = "[koala-admin] audit action=export";

function logExport(event: {
  list: ExportList;
  staffId: string | null;
  rows: number;
  pii: boolean;
  filters: Readonly<Record<string, string>>;
  sort: Paging["sort"];
}): void {
  const filters = Object.entries(event.filters)
    .filter(([name]) => name !== "boyut")
    .map(([name, value]) => `${name}=${value}`)
    .join("&");
  console.info(
    `${EXPORT_AUDIT_PREFIX} list=${event.list} staffId=${event.staffId ?? "-"} rows=${event.rows} ` +
      `pii=${event.pii} sort=${event.sort.field},${event.sort.direction} ` +
      `filters=${JSON.stringify(filters)} at=${new Date().toISOString()}`,
  );
}
