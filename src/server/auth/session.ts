import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { env } from "@/env";
import { isKoalaApiError } from "@/server/api/errors";

import {
  buildSessionCookie,
  decodeStaffSession,
  encodeStaffSession,
  type StaffSession,
} from "./cookies";
import { StaffAuthError } from "./errors";
import { refreshStaffSession } from "./staff-auth-api";

/**
 * Sunucunun, giriş yapmış personeli sorma yolları.
 *
 * {@link readStaffSession} çerezi çözer; {@link getKoalaAccessToken} backend'e
 * gidecek geçerli bir erişim token'ı verir ve **tek yoldur**.
 *
 * ```ts
 * const me = await koalaApi.get({
 *   path: "/admin/me",
 *   schema: adminMeSchema,
 *   accessToken: await getKoalaAccessToken(),
 * });
 * ```
 *
 * Hepsi `server-only`. İstemci tarafında karşılığı yok ve olmayacak: token
 * tarayıcı JavaScript'ine hiç inmez.
 */

export const SESSION_COOKIE = buildSessionCookie(env.ADMIN_PUBLIC_ORIGIN);

export const SESSION_COOKIE_NAME = SESSION_COOKIE.name;

/**
 * Erişim token'ını ölmeden bu kadar önce yenile.
 *
 * Backend'de erişim token'ı 15 dakika yaşıyor (`StaffAuthProperties`). Altmış
 * saniyelik pay, bir çağrının başında alınan token'ın çağrı bitmeden ölmesini
 * engeller.
 */
const REFRESH_SKEW_MS = 60_000;

/** Çerezdeki oturum, ya da `null`. Hiçbir zaman fırlatmaz. */
export async function readStaffSession(): Promise<StaffSession | null> {
  const store = await cookies();
  return decodeStaffSession(store.get(SESSION_COOKIE_NAME)?.value);
}

/**
 * Oturumu çereze yaz. Yalnız Server Action ve Route Handler içinde çalışır —
 * Next.js bir Server Component'in çerez yazmasına izin vermez, çünkü render'ın
 * yazacağı bir yanıt yoktur.
 */
export async function writeStaffSession(session: StaffSession): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, encodeStaffSession(session), {
    ...SESSION_COOKIE.options,
    /**
     * Çerezin ömrü yenileme token'ınınkine bağlanır: o öldükten sonra çerez
     * hiçbir işe yaramaz, tarayıcıda durması yalnız her isteği bir yenileme
     * denemesine çevirir.
     */
    expires: new Date(session.refreshExpiresAt),
  });
}

/** Çerezi düşür. Aynı kısıt: Server Action ya da Route Handler. */
export async function clearStaffSession(): Promise<void> {
  const store = await cookies();
  store.set(SESSION_COOKIE_NAME, "", { ...SESSION_COOKIE.options, maxAge: 0 });
}

export function isAccessTokenFresh(session: StaffSession, now: number = Date.now()): boolean {
  return session.accessExpiresAt - REFRESH_SKEW_MS > now;
}

/**
 * Oturum, ya da yönlendirme. Kimlik olmadan gösterecek bir şeyi olmayan
 * sayfalar için.
 *
 * `src/proxy.ts` anonim isteği zaten geri çeviriyor, yani bu ikinci kilit:
 * matcher'ın dışında kalmış bir rotayı ve kapı ile render arasındaki boşlukta
 * ölmüş bir oturumu yakalar. Fırlatmak yerine yönlendirir ki ikisi de 500
 * olarak görünmesin.
 */
export async function requireStaffSession(): Promise<StaffSession> {
  const session = await readStaffSession();

  if (session === null) {
    redirect("/giris");
  }

  if (session.mustChangePassword) {
    redirect("/giris/parola");
  }

  return session;
}

/**
 * Şu anda geçerli olan bir erişim token'ı.
 *
 * @throws {StaffAuthError} — kod hangi şeyin bozulduğunu söyler ve çağıranlar
 * farkı bilmek zorundadır: `SESSION_REQUIRED`/`SESSION_EXPIRED` "yeniden giriş
 * yapın", `PASSWORD_CHANGE_REQUIRED` "önce parolanızı değiştirin",
 * `BACKEND_UNREACHABLE` "Koala cevap vermiyor, sizinle ilgili değil".
 */
export async function getKoalaAccessToken(): Promise<string> {
  const session = await readStaffSession();

  if (session === null) {
    throw new StaffAuthError("SESSION_REQUIRED", "Oturum çerezi yok ya da çözülemedi.");
  }

  /**
   * Bayrak açıkken backend `/admin/**`'ın tamamını 403'le reddediyor, `/admin/me`
   * dâhil. Token'ı yine de verirsek panel "personel kaydınız yok" diye yanlış
   * bir cevap üretir; burada durmak o yanlış cevabı bir istek önce keser.
   *
   * Ama bu kontrol **çerezdeki** bayrağa bakıyor ve çerez imzasız: `false`
   * yazan biri buradan geçer. Bu yüzden tek başına yeterli sayılmıyor —
   * aşağıdaki yenileme yanıtı ve {@link backendSaysPasswordMustChange} aynı
   * soruyu backend'e soruyor. Buradaki kontrolün işi doğruyu **garanti etmek**
   * değil, doğru olduğu hâlde bir round trip'i harcamamak.
   */
  if (session.mustChangePassword) {
    throw new StaffAuthError(
      "PASSWORD_CHANGE_REQUIRED",
      "Hesap ilk girişte parola değiştirme bayrağıyla işaretli.",
    );
  }

  if (isAccessTokenFresh(session)) {
    return session.accessToken;
  }

  if (session.refreshExpiresAt <= Date.now()) {
    throw new StaffAuthError("SESSION_EXPIRED", "Yenileme token'ının da ömrü dolmuş.");
  }

  let refreshed: StaffSession;
  try {
    refreshed = await refreshStaffSession(session.refreshToken);
  } catch (error) {
    throw classifyRefreshFailure(error);
  }

  await persistIfWritable(refreshed);

  /**
   * Bayrak yukarıda çerezden okundu; burada **backend'den** geliyor. İkisi aynı
   * olmak zorunda değil: çerez imzasız, yani `true`'yu `false` yapmak elle
   * yapılabilir bir iş, ve o hâlde yukarıdaki kontrol sessizce geçilir. Bu
   * satır o kestirmeyi kapatan yer — bayrağın tek kaynağı token yanıtı, ve
   * yanıt her elimize geçtiğinde ona uyuyoruz.
   */
  if (refreshed.mustChangePassword) {
    throw new StaffAuthError(
      "PASSWORD_CHANGE_REQUIRED",
      "Backend yenileme yanıtında parola değiştirme bayrağını açık bildirdi.",
    );
  }

  return refreshed.accessToken;
}

/**
 * Backend'in bayrak hakkındaki **şu anki** cevabı: `true`, `false`, ya da
 * öğrenilemediyse `null`.
 *
 * Neden bir yenileme çağrısı: `mustChangePassword`'ün tek kaynağı
 * `StaffTokenDto`, yani giriş ve yenileme yanıtları. Üstelik
 * `POST /admin/auth/refresh` `permitAll` — bayrak açıkken `/admin/**`'ın geri
 * kalanı 403 dönerken bile cevap veren uçlardan biri. Ve yenileme token'ı tek
 * kullanımlık olmadığı için sorup öğrenmenin bedeli bir round trip'ten ibaret.
 *
 * Çağrılacağı tek yer `/admin/me`'nin 403'ü: o 403'ün iki sebebi var —
 * personel kaydının çözülememesi ve bu bayrak — ve panel ikisine **farklı**
 * ekran gösteriyor. Çerezdeki bayrak `false` diyorsa (elle yazılmış olabilir)
 * ayırt etmenin başka yolu yok.
 *
 * Öğrendiğini çereze de yazıyor: bir sonraki isteğin `src/proxy.ts`'i kişiyi
 * doğrudan parola ekranına götürsün diye. Yazamamak zararsız — bkz.
 * {@link persistIfWritable}.
 */
export async function backendSaysPasswordMustChange(): Promise<boolean | null> {
  const session = await readStaffSession();

  if (session === null || session.refreshExpiresAt <= Date.now()) {
    return null;
  }

  try {
    const refreshed = await refreshStaffSession(session.refreshToken);
    await persistIfWritable(refreshed);
    return refreshed.mustChangePassword;
  } catch {
    // Reddedildi ya da ulaşılamadı. İkisi de "bilmiyorum" demek, ve bilmediğini
    // "hayır" diye okumak yanlış teşhisin ta kendisi olurdu.
    return null;
  }
}

/**
 * Yenilenen oturumu yazmayı dener ve yazamazsa sessizce geçer.
 *
 * Bunun sessiz kalabilmesinin sebebi tek bir olgu: **personel yenileme
 * token'ı tek kullanımlık değil.** Backend aynı `tokenVersion` ile yeni token
 * üretir, eskisini geçersiz kılmaz. Yazamamanın bedeli, bir sonraki istekte
 * bir kez daha yenilemek; oturum kaybı değil.
 *
 * Çerezi kalıcı olarak yazan yer `src/proxy.ts`: her istek oradan geçer ve
 * yazacak bir yanıtı vardır.
 */
async function persistIfWritable(session: StaffSession): Promise<void> {
  try {
    await writeStaffSession(session);
  } catch {
    // Server Component render'ı. Bkz. yukarıdaki açıklama.
  }
}

/**
 * Başarısız bir yenilemeyi, ekranı olan bir koda çevirir.
 *
 * İhraç edilmesinin sebebi `src/proxy.ts`: o da yeniliyor, o da başarısız
 * olabiliyor, ve ayrımı orada bir kez daha yazmak iki yerde iki farklı cevap
 * üretmenin yoluydu — 401 "oturumunuz bitti", ulaşılamamak "sizinle ilgili
 * değil" demek, ve bu ikisini birleştiren bir panel, parolası bir yönetici
 * tarafından sıfırlanan kişiye backend'in çöktüğünü söyler.
 */
export function classifyRefreshFailure(error: unknown): StaffAuthError {
  if (isKoalaApiError(error)) {
    if (error.isAuthFailure || error.status === 401) {
      return new StaffAuthError("SESSION_EXPIRED", `Yenileme reddedildi: ${error.message}`, {
        cause: error,
      });
    }

    // `status === 0` taşıma hatası (DNS, bağlantı reddi, zaman aşımı) demek.
    if (error.status === 0 || error.status >= 500) {
      return new StaffAuthError("BACKEND_UNREACHABLE", `Koala yanıt vermedi: ${error.message}`, {
        cause: error,
      });
    }

    return new StaffAuthError("UNKNOWN", `Yenileme başarısız: ${error.message}`, { cause: error });
  }

  return new StaffAuthError(
    "UNKNOWN",
    error instanceof Error ? error.message : "Yenileme beklenmedik şekilde başarısız oldu.",
    { cause: error },
  );
}
