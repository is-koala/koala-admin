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
   * bir cevap üretir; burada durup doğru sebebi söylemek, o yanlış cevabın
   * önündeki tek şey.
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
    throw toAuthError(error);
  }

  await persistIfWritable(refreshed);
  return refreshed.accessToken;
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

function toAuthError(error: unknown): StaffAuthError {
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
