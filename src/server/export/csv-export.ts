import "server-only";

import { csvDocument, csvFileName, type CsvCell } from "@/lib/csv";
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
 * PII: ad-soyad ve kullanıcı adı sütunları yalnız `user.read_pii` taşıyan
 * personele yazılır; kimlik sütunları herkese. Ekranda ad görünüyor, ama
 * ekran yirmi satırdır; bin satırlık bir dosya toplu kişisel veri
 * aktarımıdır ve panelin PII kapısı odur.
 *
 * Denetim: backend'de "export" diye bir eylem yok — liste GET'inin izin
 * kontrolü backend denetim kaydına kendi satırını yazar, ama o satır sayfa
 * mı dışa aktarma mı ayırmaz. Rota bu yüzden tek satırlık yapılandırılmış
 * bir günlük yazar (`[koala-admin] audit action=export …`): kim, hangi
 * liste, hangi süzgeç, kaç satır, PII açık mı. Backend'e yazılabilen bir
 * denetim ucu geldiğinde bu satır oraya taşınır.
 */

export interface ExportColumn<Row> {
  readonly header: string;
  readonly cell: (row: Row) => CsvCell;
  /** Yalnız `user.read_pii` varken yazılır. */
  readonly pii?: boolean;
}

export interface ExportSpec<Row> {
  readonly list: ExportList;
  readonly permission: Permission;
  /** Dosya adının ASCII gövdesi: `atamalar-2026-09-14.csv`. */
  readonly fileStem: string;
  /** Backend'in bu uç için sayfa tavanı; hakediş ucu 50 (PageableSanitizer yok). */
  readonly pageSize?: number;
  readonly columns: readonly ExportColumn<Row>[];
  /** Adresi görünüme çevirir; günlük satırı için süzgeç özeti de buradan. */
  readonly readView: (params: SearchParams) => {
    paging: Paging;
    state: Readonly<Record<string, string>>;
  };
  readonly fetchPage: (
    accessToken: string,
    params: SearchParams,
    page: { page: number; size: number },
  ) => Promise<PageDto<Row>>;
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

export async function exportCsv<Row>(request: Request, spec: ExportSpec<Row>): Promise<Response> {
  const context = await getStaffContext();
  if (context.failure !== null) {
    return refuse(FAILURE_STATUS[context.failure.kind], "Dışa aktarma için oturum doğrulanamadı.");
  }
  if (!context.has(spec.permission)) {
    return refuse(403, "Bu dışa aktarma için yetkiniz yok.");
  }

  const params = searchParamsOf(new URL(request.url));
  const showPii = context.has("user.read_pii");
  const columns = spec.columns.filter((column) => column.pii !== true || showPii);
  const size = Math.min(MAX_PAGE_SIZE, spec.pageSize ?? MAX_PAGE_SIZE);
  const view = spec.readView(params);

  let rows: Row[];
  try {
    const accessToken = await getKoalaAccessToken();
    rows = await collectRows(size, (page) => spec.fetchPage(accessToken, params, { page, size }));
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
    filters: view.state,
    sort: view.paging.sort,
  });

  return new Response(body, {
    status: 200,
    headers: {
      ...HEADERS,
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFileName(spec.fileStem)}"`,
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
export function searchParamsOf(url: URL): SearchParams {
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
