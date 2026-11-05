/**
 * Konum alanının `user.read_pii` kapısından geçmiş hâli (koala-admin#135,
 * #133'teki biniş konumuyla aynı kalıp).
 *
 * Kapının iki yarısı vardır: bu işlev sunucu yarısıdır — okuyucu izinli
 * değilse koordinat dönen veriye hiç girmez, bileşen görmediğini çizemez;
 * bileşen de `withheld` için "konum var" notunu yazar (arayüz yarısı).
 *
 * koala-backend#352'den beri backend de izinsiz okuyucuya koordinatı `null`
 * gönderir ve bunu ayrı bir bayrakla söyler (`…Withheld`). O bayrak olmadan
 * maskelenmiş `null` "konum yok" sanılır ve "konum var" notu canlıda hiç
 * çıkmaz; bu yüzden işlev sunucu bayrağını da zorunlu argüman olarak alır.
 * Panelin kendi kapısı yine kalır: #352 öncesi sunucu koordinatı izinsiz
 * okuyucuya da gönderir.
 *
 * `server-only` yok: yalnız metin işleme.
 */

/**
 * `shown` yalnız izinli okuyucuda üretilir. `withheld` kaydın konum taşıdığını
 * ama okuyanın göremediğini söyler (koordinat taşınmaz). `none` kayıtta konum
 * yok; yarım koordinat da `none`dır, yarım bir yer çizilmez.
 */
export type GatedLocation =
  | { readonly kind: "shown"; readonly latitude: string; readonly longitude: string }
  | { readonly kind: "withheld" }
  | { readonly kind: "none" };

type Coordinate = number | string | null;

/**
 * Kural (koala-admin#134 biniş konumuyla birebir aynı):
 * 1. Koordinat eksik (null ya da yarım) ve sunucu `withheldByServer` dedi →
 *    `withheld`; okuyucunun izni ne olursa olsun, çünkü elde koordinat yok.
 * 2. Koordinat eksik, bayrak yok → `none`.
 * 3. Koordinat tam, okuyucu izinsiz → `withheld` (#352 öncesi sunucu).
 * 4. Koordinat tam, okuyucu izinli → `shown`.
 *
 * `withheldByServer` eski sunucuda alan olmadığı için şemada `false`a düşer.
 */
export function gateLocation(
  latitude: Coordinate,
  longitude: Coordinate,
  canReadLocation: boolean,
  withheldByServer: boolean,
): GatedLocation {
  if (latitude === null || longitude === null) {
    return withheldByServer ? { kind: "withheld" } : { kind: "none" };
  }
  if (!canReadLocation) return { kind: "withheld" };
  return { kind: "shown", latitude: String(latitude), longitude: String(longitude) };
}
