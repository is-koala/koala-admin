import { istanbulDayBoundary } from "@/lib/format";
import { readParam, type SearchParams } from "@/server/api/paging";

/**
 * Liste sayfalarının ortak tarih aralığı (koala-admin#110).
 *
 * Adreste iki gün yaşar: `?baslangic=2026-09-01&bitis=2026-09-14`. Backend'e
 * `from`/`to` olarak, `createdAt` üzerinde ve iki sınır dahil gider
 * (koala-backend#301). Gün, dilimli bir ana burada çevrilir: başlangıç günün
 * ilk anı, bitiş `23:59:59.999` — ikisi de Europe/Istanbul'da
 * (`istanbulDayBoundary`). Denetim kaydı sayfası aynı dönüşümü yapıyordu;
 * dört liste ve dışa aktarma rotaları da aynı yerden geçsin diye burada.
 *
 * Dilimsiz bir değer backend'de 400'dür; bu modül dilimsiz değer üretmez ve
 * biçimi bozuk bir günü (`2026-13-40`, `dün`) backend'e taşımaz — süzgeç
 * düşer, liste süzgeçsiz açılır. `network`e dokunmaz: sunucu rotası da
 * sayfa da aynı okuyucuyu çağırır.
 */

export const DATE_FROM_PARAM = "baslangic";
export const DATE_TO_PARAM = "bitis";

export interface DateRange {
  /** `YYYY-MM-DD` ya da yok. */
  readonly fromDay: string | null;
  readonly toDay: string | null;
}

export const EMPTY_DATE_RANGE: DateRange = { fromDay: null, toDay: null };

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Takvimde var olan bir gün mü: `2026-02-30` biçime uyar ama gün değildir. */
export function isCalendarDay(value: string): boolean {
  if (!DAY.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function readDay(params: SearchParams, key: string): string | null {
  const raw = readParam(params, key)?.trim() ?? "";
  return isCalendarDay(raw) ? raw : null;
}

/** Adresten iki günü okur; geçersiz olan düşer, diğeri kalır. */
export function readDateRange(params: SearchParams): DateRange {
  return { fromDay: readDay(params, DATE_FROM_PARAM), toDay: readDay(params, DATE_TO_PARAM) };
}

export function hasDateRange(range: DateRange): boolean {
  return range.fromDay !== null || range.toDay !== null;
}

/**
 * Backend parametreleri. `from` günün başı, `to` günün sonu; ikisi de
 * `Z` ile biten ISO anı. Boş taraf `undefined`: `koalaApi` onu adrese yazmaz.
 */
export function dateRangeQuery(range: DateRange): {
  from: string | undefined;
  to: string | undefined;
} {
  return {
    from:
      range.fromDay === null
        ? undefined
        : (istanbulDayBoundary(range.fromDay, "start") ?? undefined),
    to: range.toDay === null ? undefined : (istanbulDayBoundary(range.toDay, "end") ?? undefined),
  };
}

/** Liste görünümüne (`viewState`) eklenen anahtarlar; boş taraf yazılmaz. */
export function dateRangeState(range: DateRange): Readonly<Record<string, string>> {
  return {
    ...(range.fromDay === null ? {} : { [DATE_FROM_PARAM]: range.fromDay }),
    ...(range.toDay === null ? {} : { [DATE_TO_PARAM]: range.toDay }),
  };
}

/**
 * `1 Eyl 2026 – 14 Eyl 2026 arası`; tek taraflıysa `1 Eyl 2026 ve sonrası` /
 * `14 Eyl 2026 ve öncesi`. Ek almayan kalıp bilerek: `'dan` / `'ya` ekleri
 * yılın son hecesine göre değişir (2026'dan, 2023'ten, 2030'dan…) ve burada
 * ünlü/ünsüz uyumu kurmak bir tarih özeti için fazla.
 */
export function describeDateRange(range: DateRange): string {
  const from = range.fromDay === null ? null : formatDay(range.fromDay);
  const to = range.toDay === null ? null : formatDay(range.toDay);
  if (from !== null && to !== null) return `${from} – ${to} arası`;
  if (from !== null) return `${from} ve sonrası`;
  if (to !== null) return `${to} ve öncesi`;
  return "";
}

const MONTHS = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function formatDay(day: string): string {
  const [year, month, date] = day.split("-");
  return `${Number(date)} ${MONTHS[Number(month) - 1]} ${year}`;
}

/**
 * Bu anın Europe/Istanbul'daki günü, `YYYY-MM-DD`. CSV dosya adı bunu taşır:
 * UTC'de koşan bir konteynerde gece 01:00'de indirilen dosya "dünün" adını
 * almamalı.
 */
export function istanbulDay(at: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(at);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("year")}-${read("month")}-${read("day")}`;
}
