import { revalidatePath } from "next/cache";

/**
 * Başarılı panel yazımından sonra ilgili RSC önbelleğini düşürür.
 *
 * `force-dynamic` gövdeyi derlemez; istemci router'ı kuyruk satırını ve ana
 * ekran sayılarını yine de tutar. Yenilemezsek operatör eski durumu görür ve
 * aynı formu ikinci kez gönderir. İstisna yutulur: yazım backend'de bitti,
 * başarı cümlesi kaybolmasın.
 */
export function revalidateAfterWrite(...paths: readonly string[]): void {
  try {
    for (const path of paths) {
      revalidatePath(path);
    }
  } catch {
    // Yazım tamam. Router yenilenmezse sayfa yenilemesi yeter.
  }
}
