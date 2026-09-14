import type { Route } from "next";

import { isUuid, listHref } from "@/lib/panel-href";
import { shortId } from "@/lib/short-id";
import { readParam, type SearchParams } from "@/server/api/paging";
import { navLabel, type NavRoutePath } from "@/server/authz/routes";

/**
 * Kırıntı (koala-admin#112): nesne sayfası konumunu "liste › nesne" olarak
 * yazar ve liste bağlantısı geldiği süzgeci korur.
 *
 * Süzgeç `Referer`'dan değil adresten okunur: liste sayfası satır
 * bağlantısına o anki görünümünü (`durum`, `sirala`, `sayfa`, …) ekler,
 * nesne sayfası aynı anahtarları geri okur. Şirket, kimlik ve hesap silme
 * sayfaları bunu koala-admin#100'den beri kendi başına yapıyordu; anahtar
 * listesi artık tek yerde. Yer imi de aynı yoldan çalışır — adres kendi
 * bağlamını taşır.
 */

/**
 * Nesne adresine taşınan ve kırıntının geri okuduğu liste anahtarları. Panelin
 * Türkçe URL sözlüğü: sayfalama üçlüsü, durum, arama ve kimlik süzgeçleri.
 * `atama`/`hakedis` gibi tekil bakış anahtarları bilerek yok — onlar süzgeç
 * değil, aynı sayfadaki bir form doldurmasıdır.
 */
export const QUEUE_STATE_KEYS = [
  "durum",
  "ara",
  "sirala",
  "boyut",
  "sayfa",
  "isci",
  "isveren",
  "sirket",
  "kullanici",
  "sikayetci",
] as const;

export type QueueState = Readonly<Record<string, string>>;

/** Nesne adresindeki liste anahtarlarını geri toplar; tanınmayanlar düşer. */
export function readQueueState(params: SearchParams): QueueState {
  const state: Record<string, string> = {};
  for (const key of QUEUE_STATE_KEYS) {
    const value = readParam(params, key);
    if (value !== null) state[key] = value;
  }
  return state;
}

export interface BreadcrumbItem {
  readonly label: string;
  /** Yoksa bu kırıntı geçerli sayfadır ve bağlantı değil metin olarak çizilir. */
  readonly href?: Route;
  /** Kimlik kısaltması: eş aralıklı yazılır, tam değer `title`'da. */
  readonly title?: string;
  readonly mono?: boolean;
}

/**
 * Liste sayfasının satır bağlantısına eklediği görünüm: süzgeçler artı
 * bulunulan sayfa. `sayfa` `viewState`'te yoktur (sayfalayıcı onu kendi
 * yazar), nesne adresine burada eklenir ki kırıntı aynı sayfaya dönsün.
 */
export function objectQueryFor(viewState: QueueState, page: number): QueueState {
  return { ...viewState, sayfa: String(page) };
}

/** Menüdeki liste sayfası, taşınan görünümle: kırıntının ilk halkası. */
export function listCrumb(path: NavRoutePath, state: QueueState = {}): BreadcrumbItem {
  return { label: navLabel(path), href: listHref(path, state) };
}

/** Nesnenin kendisi: kısa kimlik, tam kimlik `title`'da; UUID değilse olduğu gibi. */
export function objectCrumb(objectId: string): BreadcrumbItem {
  return isUuid(objectId)
    ? { label: shortId(objectId), title: objectId, mono: true }
    : { label: objectId };
}

/**
 * "Liste › nesne" kırıntısı. Nesnenin adı burada yok: başlık satırı izin
 * kapısından önce çizilir ve kapı geçilmeden nesne okunmaz; kimlik kısaltması
 * adres çubuğundaki bilgiyi taşır, ad gövdede zaten yazılıdır. Liste adı
 * menüden gelir, süzgeç `readQueueState`'ten.
 */
export function objectBreadcrumb(
  listPath: NavRoutePath,
  objectId: string,
  state: QueueState = {},
): readonly BreadcrumbItem[] {
  return [listCrumb(listPath, state), objectCrumb(objectId)];
}
