"use server";

import { redirect } from "next/navigation";

import { isKoalaApiError } from "@/server/api/errors";

import type { StaffSession } from "./cookies";
import type { PasswordChangeFailureCode, SignInFailureCode } from "./errors";
import {
  changeStaffPassword,
  loginStaff,
  logoutStaff,
  refreshStaffSession,
} from "./staff-auth-api";
import {
  clearStaffSession,
  isAccessTokenFresh,
  readStaffSession,
  writeStaffSession,
} from "./session";

/**
 * Panelin üç kimlik eylemi: gir, çık, parolanı değiştir.
 *
 * Üçü de Server Action — yani çerezi yazabilen tek yer sınıfı. Tarayıcı bu
 * uçlarda backend'i hiç görmez: form Next sunucusuna gider, Koala ile konuşan
 * odur (ADR-0011'in BFF mantığı) ve token tarayıcıya hiç inmez.
 *
 * ### Hata neden sorgu dizesinden dönüyor?
 *
 * `useActionState` bir Client Component gerektirirdi. Giriş sayfası bugün
 * **hiç istemci JavaScript'i göndermiyor** ve bu, kimlik bilgisi yazılan bir
 * sayfa için ucuza satılmayacak bir özellik. Bunun yerine başarısızlıkta
 * sayfaya bir kodla geri dönülüyor.
 *
 * Sorgu dizesine giden şey **yalnız bir kod**: e-posta, parola ya da token
 * hiçbir koşulda URL'e yazılmaz — URL sunucu günlüğüne, tarayıcı geçmişine ve
 * `Referer` başlığına düşer.
 */

export async function signInWithPassword(
  callbackUrl: string | undefined,
  formData: FormData,
): Promise<void> {
  const target = safeCallbackUrl(callbackUrl);
  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (email === "" || password === "") {
    redirect(`/giris?${signInFailureQuery("MISSING_FIELDS", target)}`);
  }

  let session: StaffSession;
  try {
    session = await loginStaff(email, password);
  } catch (error) {
    redirect(`/giris?${signInFailureQuery(toSignInFailure(error), target)}`);
  }

  await writeStaffSession(session);

  /**
   * İlk giriş bayrağı açıksa hedef sayfaya göndermenin anlamı yok: backend
   * `/admin/**`'ın tamamını reddedeceği için kişi boş bir panele düşerdi.
   */
  redirect(session.mustChangePassword ? "/giris/parola" : target);
}

/**
 * Çıkış: önce backend'e, sonra çereze.
 *
 * Sıra önemli. Backend `tokenVersion`'ı artırarak o personelin bütün açık
 * token'larını öldürür; yalnız çerezi silmek, panelin sizi unutması ama
 * token'ın ömrü dolana kadar geçerli kalması demekti.
 *
 * Backend'e ulaşılamazsa da çerez yine düşer: çıkmak isteyen birini panelde
 * bırakmak daha kötü bir sonuç. Bu durumda sunucu tarafındaki token, ömrü
 * dolana kadar (erişim için 15 dakika) geçerli kalır ve bu bilinen bir sınır.
 */
export async function signOut(): Promise<void> {
  const session = await readStaffSession();

  if (session !== null) {
    try {
      await logoutStaff(await usableAccessToken(session));
    } catch (error) {
      console.warn(
        `[staff-auth] çıkışta backend çağrısı başarısız: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  await clearStaffSession();
  redirect("/giris");
}

/**
 * Kişinin kendi parolasını değiştirmesi — ilk girişte zorunlu olan adım.
 *
 * Başarıdan sonra çerez **silinir**: backend parola değişiminde `tokenVersion`'ı
 * artırıyor, yani elimizdeki token o anda ölüyor. Onu tutmak, bir sonraki
 * isteğin sebepsiz 401 almasıyla biterdi.
 */
export async function changeOwnPassword(formData: FormData): Promise<void> {
  const session = await readStaffSession();

  if (session === null) {
    redirect("/giris");
  }

  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const newPasswordRepeat = String(formData.get("newPasswordRepeat") ?? "");

  if (currentPassword === "" || newPassword === "") {
    redirect(`/giris/parola?hata=MISSING_FIELDS`);
  }

  if (newPassword !== newPasswordRepeat) {
    redirect(`/giris/parola?hata=MISMATCH`);
  }

  try {
    await changeStaffPassword(await usableAccessToken(session), currentPassword, newPassword);
  } catch (error) {
    redirect(`/giris/parola?hata=${toPasswordFailure(error)}`);
  }

  await clearStaffSession();
  redirect("/giris?bilgi=PASSWORD_CHANGED");
}

/**
 * Bu iki uç `getKoalaAccessToken()` kullanamaz: o, `mustChangePassword` açıkken
 * bilerek hata fırlatır — oysa parola değiştirme ucu tam olarak o durumda
 * çalışmak zorunda olan uçtur (backend'de izin denetimine değil doğrudan
 * `STAFF_AUTHORITY`'ye bağlı). Bu yüzden token buradan, taze değilse bir
 * yenilemeyle alınıyor.
 *
 * "Taze" sorusuna cevabı {@link isAccessTokenFresh} veriyor, elle yazılmış bir
 * pay değil. Payı kim değiştirirse `session.ts`'te değiştirir ve burası onu
 * izler; iki ayrı kopya, ikincisini güncellemeyi unutan kişiye hiçbir şey
 * söylemezdi.
 */
async function usableAccessToken(session: StaffSession): Promise<string> {
  if (isAccessTokenFresh(session)) {
    return session.accessToken;
  }

  const refreshed = await refreshStaffSession(session.refreshToken);
  return refreshed.accessToken;
}

/**
 * Sorgu dizesi — yalnız bir hata kodu ve kişinin gitmek istediği panel yolu.
 * E-posta bilerek taşınmıyor: kişisel veri URL'e, günlüğe ve `Referer`
 * başlığına yazılmaz. Bedeli, formun e-posta alanının boşalması.
 */
function signInFailureQuery(code: SignInFailureCode, callbackUrl: string): string {
  const params = new URLSearchParams({ hata: code });
  if (callbackUrl !== "/") params.set("callbackUrl", callbackUrl);
  return params.toString();
}

function toSignInFailure(error: unknown): SignInFailureCode {
  if (!isKoalaApiError(error)) return "UNKNOWN";

  // Backend yanlış parolayı, olmayan hesabı, kilitli hesabı ve devre dışı
  // hesabı ayırt edilemez kılıyor; panel de tek bir mesaj verir.
  if (error.status === 401) return "INVALID_CREDENTIALS";
  if (error.status === 429) return "TOO_MANY_ATTEMPTS";
  if (error.status === 0 || error.status >= 500) return "BACKEND_UNREACHABLE";
  if (error.isValidationFailure) return "MISSING_FIELDS";

  return "UNKNOWN";
}

function toPasswordFailure(error: unknown): PasswordChangeFailureCode {
  if (!isKoalaApiError(error)) return "UNKNOWN";

  if (error.status === 401) return "CURRENT_PASSWORD_WRONG";
  if (error.status === 409) return "PASSWORD_UNCHANGED";
  if (error.isValidationFailure) return "PASSWORD_REJECTED";
  if (error.status === 0 || error.status >= 500) return "BACKEND_UNREACHABLE";

  return "UNKNOWN";
}

/**
 * Yalnız bu panele geri dön.
 *
 * `callbackUrl` proxy'nin yazdığı sorgu dizesinden geliyor ve sorgu dizesi
 * kullanıcı girdisidir: buraya mutlak bir URL koyabilmek, giriş sayfasını
 * panelin itibarını ödünç veren açık bir yönlendiriciye çevirirdi.
 *
 * Dönüş tipindeki dönüştürme `typedRoutes` yüzünden: değer derleme anında değil
 * çalışma anında doğrulanıyor, yani tip sistemi onu bir rota olarak tanıyamaz.
 * Dönüştürmenin güvenli olmasını sağlayan şey aşağıdaki aynı-origin denetimi —
 * bu yüzden dönüştürme, doğrulamanın yapıldığı yerde duruyor ve çağrı yerlerine
 * dağılmıyor.
 */
function safeCallbackUrl(candidate: string | undefined): Parameters<typeof redirect>[0] {
  if (candidate === undefined || !isCanonicalSameOriginPath(candidate)) {
    return "/";
  }

  return candidate as Parameters<typeof redirect>[0];
}

/**
 * Yönlendirme hedefini gerçek panel adresine ihtiyaç duymadan WHATWG kurallarıyla
 * çözmek için kullanılan nötr origin. Burada yalnız çözülen origin'in aynı kalıp
 * kalmadığı soruluyor; hostun kendisi hiçbir yanıta yazılmıyor.
 */
const CALLBACK_VALIDATION_ORIGIN = "https://callback.koala.invalid";

/** Ham değer ve URL sorgusunun çözebileceği iki kodlama katmanı. */
const CALLBACK_SECURITY_LAYERS = 3;

const UNSAFE_CALLBACK_CHARACTER = /[\\\u0000-\u001f\u007f-\u009f]/;

function isCanonicalSameOriginPath(candidate: string): boolean {
  let inspected = candidate;

  for (let layer = 0; layer < CALLBACK_SECURITY_LAYERS; layer += 1) {
    if (!isSafeCallbackLayer(inspected)) return false;

    const decoded = decodePercentEncodedLayer(inspected);
    if (decoded === null) return false;
    if (decoded === inspected) return true;
    inspected = decoded;
  }

  // Daha fazla kodlama katmanını kabul etmek doğrulama işini sınırsızlaştırır;
  // kanonik olmayan böyle bir hedef güvenli varsayılmak yerine reddedilir.
  return false;
}

function isSafeCallbackLayer(candidate: string): boolean {
  if (
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    UNSAFE_CALLBACK_CHARACTER.test(candidate)
  ) {
    return false;
  }

  try {
    return new URL(candidate, CALLBACK_VALIDATION_ORIGIN).origin === CALLBACK_VALIDATION_ORIGIN;
  } catch {
    return false;
  }
}

/**
 * Bir percent-encoding katmanını yalnız denetim kopyasında açar. Böylece `%25`
 * arkasındaki ASCII saldırıları ve UTF-8 ile kodlanmış C1 kontrolleri görünür
 * olur; doğrulama başarılıysa çağırana yine özgün query/hash değeri döner.
 */
function decodePercentEncodedLayer(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}
