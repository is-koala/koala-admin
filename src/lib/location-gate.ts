/**
 * Konum alanının `user.read_pii` kapısından geçmiş hâli (koala-admin#135,
 * #133'teki biniş konumuyla aynı kalıp).
 *
 * Backend atama ucunda konumu izne göre maskelemiyor (yalnız `payment.read`
 * ister), bu yüzden kapı panelin kendisindedir ve iki yarısı vardır: bu işlev
 * sunucu yarısıdır — okuyucu izinli değilse koordinat dönen veriye hiç girmez,
 * bileşen görmediğini çizemez; bileşen de `withheld` için "konum var" notunu
 * yazar (arayüz yarısı).
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

export function gateLocation(
  latitude: Coordinate,
  longitude: Coordinate,
  canReadLocation: boolean,
): GatedLocation {
  if (latitude === null || longitude === null) return { kind: "none" };
  if (!canReadLocation) return { kind: "withheld" };
  return { kind: "shown", latitude: String(latitude), longitude: String(longitude) };
}
