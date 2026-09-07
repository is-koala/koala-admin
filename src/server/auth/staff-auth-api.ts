import "server-only";

import { z } from "zod";

import { koalaApi, koalaRequestNoData } from "@/server/api/koala";

import type { StaffSession } from "./cookies";

/**
 * `/admin/auth/**` sözleşmesi ve onu bilen tek modül.
 *
 * `src/server/authz/me.ts` `/admin/me` için ne yapıyorsa bu da giriş uçları
 * için onu yapıyor: tel üzerindeki biçim tek bir dosyada durur, üstündeki
 * katman (`session.ts`, `actions.ts`) yalnız {@link StaffSession} ile
 * ilgilenir.
 *
 * Backend tarafı (koala-backend `StaffSecurityConfig`, doğrulanmış):
 *
 * ```
 * POST /admin/auth/login     permitAll                  → StaffTokenDto
 * POST /admin/auth/refresh   permitAll                  → StaffTokenDto
 * POST /admin/auth/logout    STAFF_AUTHORITY gerekir    → veri yok
 * POST /admin/auth/password  STAFF_AUTHORITY gerekir    → veri yok
 * ```
 *
 * `logout` ve `password`, izin denetimine değil doğrudan `STAFF_AUTHORITY`'ye
 * bağlı; bu yüzden `mustChangePassword` bayrağı açıkken de çalışırlar. Geri
 * kalan her `/admin/**` ucu o bayrak inene kadar 403 döner — parola ekranının
 * çalışabilmesinin tek sebebi bu istisna.
 */

export const STAFF_LOGIN_PATH = "/admin/auth/login";
export const STAFF_REFRESH_PATH = "/admin/auth/refresh";
export const STAFF_LOGOUT_PATH = "/admin/auth/logout";
export const STAFF_PASSWORD_PATH = "/admin/auth/password";

/**
 * `StaffTokenDto`. Süreler backend'de `Instant` olarak üretilir ve JSON'a ISO-8601
 * olarak iner; burada milisaniyeye çevriliyor, çünkü çerezde ve
 * karşılaştırmalarda tek bir birim istiyoruz ve alan adı hangisi olduğunu
 * söylüyor.
 */
const staffTokenSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  accessExpiresAt: z.iso.datetime(),
  refreshExpiresAt: z.iso.datetime(),
  mustChangePassword: z.boolean(),
});

function toSession(payload: z.infer<typeof staffTokenSchema>): StaffSession {
  return {
    accessToken: payload.accessToken,
    refreshToken: payload.refreshToken,
    accessExpiresAt: Date.parse(payload.accessExpiresAt),
    refreshExpiresAt: Date.parse(payload.refreshExpiresAt),
    mustChangePassword: payload.mustChangePassword,
  };
}

/**
 * E-posta + parola karşılığında Koala'nın personel token'ları.
 *
 * `KoalaApiError` fırlatır; 401'in "yanlış parola" mı "olmayan hesap" mı
 * olduğunu ayırt etmeye çalışmayın — backend ikisini bilerek ayırt edilemez
 * kılıyor ve panelin bunu bozacak bir bilgisi yok.
 */
export async function loginStaff(email: string, password: string): Promise<StaffSession> {
  const payload = await koalaApi.post({
    path: STAFF_LOGIN_PATH,
    schema: staffTokenSchema,
    body: { email, password },
    // Bir kimlik doğrulama isteği asla önbelleğe girmez.
    cache: "no-store",
  });

  return toSession(payload);
}

/**
 * Yenileme token'ıyla taze bir token kümesi.
 *
 * Yenileme token'ı **tek kullanımlık değil**: backend
 * `StaffAccountManager.refresh` aynı `tokenVersion` ile yeni token üretir ve
 * eskisini geçersiz kılmaz. Bu yüzden aynı token'ı iki kez harcamak — eş
 * zamanlı bir proxy ve bir render'ın kolayca yapacağı şey — oturumu düşürmez,
 * ve önceki katmandaki uçuş-hâlindeki-istek haritası bütün gerekçesiyle
 * birlikte kalktı.
 *
 * Oturumu gerçekten bitiren tek şey `tokenVersion`'ın artması: çıkış, parola
 * değişimi ve hesabın devre dışı bırakılması.
 */
export async function refreshStaffSession(refreshToken: string): Promise<StaffSession> {
  const payload = await koalaApi.post({
    path: STAFF_REFRESH_PATH,
    schema: staffTokenSchema,
    body: { refreshToken },
    cache: "no-store",
  });

  return toSession(payload);
}

/**
 * Sunucu tarafında çıkış: backend `tokenVersion`'ı artırır, böylece o personelin
 * **bütün** açık token'ları — başka bir tarayıcıdakiler dâhil — anında ölür.
 *
 * Yerel çerezi silmek tek başına yetmez ve yetmediği görülmez: panel sizi
 * unutur, token ise ömrü dolana kadar geçerli kalırdı.
 */
export async function logoutStaff(accessToken: string): Promise<void> {
  await koalaRequestNoData({
    path: STAFF_LOGOUT_PATH,
    method: "POST",
    accessToken,
    cache: "no-store",
  });
}

/**
 * Kişinin kendi parolasını değiştirmesi.
 *
 * Başarı hâlinde backend `mustChangePassword` bayrağını düşürür **ve**
 * `tokenVersion`'ı artırır — yani bu çağrıdan sonra elimizdeki token ölmüştür.
 * Çağıranın işi çerezi düşürüp kişiyi yeniden girişe göndermektir; sessizce
 * devam etmek, bir sonraki isteğin sebepsiz 401 almasıyla biterdi.
 */
export async function changeStaffPassword(
  accessToken: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  await koalaRequestNoData({
    path: STAFF_PASSWORD_PATH,
    method: "POST",
    accessToken,
    body: { currentPassword, newPassword },
    cache: "no-store",
  });
}
