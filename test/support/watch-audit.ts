import { HttpResponse, http } from "msw";

import { auditPageBody, type AuditEntryBody } from "../fixtures/audit-log";
import { apiUrl, server } from "../msw";

const AUDIT_LOG = apiUrl("/admin/audit-log");

/**
 * `ObjectTimeline`'ın denetim yarısını izler (koala-admin#107): her
 * `GET /admin/audit-log` çağrısının URL'sini saklar ve verilen satırları
 * döner. `respond` verilirse gövde yerine o cevap (ör. 503) kullanılır.
 * Birden çok kimlik sorgulanırken `rowsFor` kimliğe göre satır seçer.
 */
export interface AuditWatch {
  readonly urls: URL[];
  /** Belirli bir `resourceId` için atılan istekler. */
  urlsFor(resourceId: string): URL[];
}

export interface WatchAuditOptions {
  readonly rows?: readonly AuditEntryBody[];
  readonly totalElements?: number;
  /** `resourceId` → satırlar; verilirse `rows` yerine bu kullanılır, eşleşmeyen kimlik boş döner. */
  readonly rowsFor?: Readonly<Record<string, readonly AuditEntryBody[]>>;
  readonly respond?: (url: URL) => Response;
}

export function watchAudit(options: WatchAuditOptions = {}): AuditWatch {
  const urls: URL[] = [];
  server.use(
    http.get(AUDIT_LOG, ({ request }) => {
      const url = new URL(request.url);
      urls.push(url);
      if (options.respond !== undefined) return options.respond(url);
      const resourceId = url.searchParams.get("resourceId") ?? "";
      const content =
        options.rowsFor !== undefined ? (options.rowsFor[resourceId] ?? []) : (options.rows ?? []);
      return HttpResponse.json(
        auditPageBody({ content, totalElements: options.totalElements, size: 10 }),
      );
    }),
  );
  return {
    urls,
    urlsFor: (resourceId) =>
      urls.filter((url) => url.searchParams.get("resourceId") === resourceId),
  };
}

/**
 * Fixture'ın ayrıntı yarısı (`requestBody`, `ip`, `userAgent`, `before`,
 * `after`) çizelgeye girmez: kişisel veri, yalnız denetim sayfasının
 * ayrıntı panelinde. Her çizelge testi bu kilidi çevirir; JSON gövdelerin
 * yaprak dizeleri tek tek aranır ki kaçış ya da girinti farkı kilidi
 * gevşetmesin.
 */
export function detailValuesOf(entry: AuditEntryBody): readonly string[] {
  const values: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") {
      values.push(value);
    } else if (Array.isArray(value)) {
      value.forEach(collect);
    } else if (value !== null && typeof value === "object") {
      Object.values(value).forEach(collect);
    }
  };
  collect(entry.requestBody);
  collect(entry.before);
  collect(entry.after);
  if (entry.ip !== null) values.push(entry.ip);
  if (entry.userAgent !== null) values.push(entry.userAgent);
  return values;
}
