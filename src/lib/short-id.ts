import { isUuid } from "@/lib/panel-href";

/**
 * Bir UUID'nin ilk bloğu (`3f2a1b4c`). Kırıntıda ve adı çözülemeyen personel
 * için gösterilir; tam kimlik `title`'da kalır. UUID olmayan bir değer olduğu
 * gibi döner — zaten kısa ya da zaten yanlış. Ayrı modül: kırıntı menü
 * kaydını bilir, zaman çizelgesi ağ ve menü bilmez; ikisi de yalnız buna
 * bağımlı (koala-admin#112).
 */
export function shortId(id: string): string {
  return isUuid(id) ? id.slice(0, 8) : id;
}
