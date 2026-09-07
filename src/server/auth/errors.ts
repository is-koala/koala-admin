/**
 * Panelin bir isteğin arkasına neden kullanılabilir bir personel kimliği
 * koyamadığı.
 *
 * Bunlar bilerek tek bir "giriş başarısız"a indirgenmiyor: kullanıcıya
 * hepsi aynı görünür, ama sorunu çözecek kişi için tamamen farklı şeylerdir.
 *
 *  - `SESSION_REQUIRED` / `SESSION_EXPIRED` — yeniden giriş yapın. Bozuk bir
 *    şey yok.
 *  - `PASSWORD_CHANGE_REQUIRED` — kimlik doğru, oturum açık; backend parola
 *    değiştirilene kadar `/admin/**`'ın tamamını reddediyor. Bu bir yetki
 *    eksikliği DEĞİL, tek adımlık bir engel. Ayrı tutulmasının sebebi: backend
 *    bunu da 403'le söyler, yani "izniniz yok" ile aynı statü — ve `OWNER`'a
 *    "izniniz yok" demek onu rol aramaya gönderir.
 *  - `BACKEND_UNREACHABLE` — Koala cevap vermiyor. ADR-0014'ün kazancı burada
 *    görünür: panel artık ayrı bir kimlik servisine bağlı değil, yalnız
 *    Koala'ya. Koala ayaktaysa panel de ayakta.
 */
export const AUTH_FAILURE_CODES = [
  "SESSION_REQUIRED",
  "SESSION_EXPIRED",
  "PASSWORD_CHANGE_REQUIRED",
  "BACKEND_UNREACHABLE",
  "UNKNOWN",
] as const;

export type AuthFailureCode = (typeof AUTH_FAILURE_CODES)[number];

export function isAuthFailureCode(value: unknown): value is AuthFailureCode {
  return typeof value === "string" && (AUTH_FAILURE_CODES as readonly string[]).includes(value);
}

/**
 * Sunucu tarafındaki oturum okuyucularının, bir isteğe personel kimliği
 * veremediklerinde fırlattığı hata. Hazır bir metin değil kodu taşır: kişinin
 * ne göreceğine Server Component karar verir, günlükte ise makine tarafından
 * okunabilir sebep kalır.
 */
export class StaffAuthError extends Error {
  override readonly name = "StaffAuthError";

  constructor(
    readonly code: AuthFailureCode,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(message ?? code, options);
  }
}

export function isStaffAuthError(value: unknown): value is StaffAuthError {
  return value instanceof StaffAuthError;
}

/**
 * Giriş formunun kendi kelime dağarcığı — yukarıdakinden ayrı, çünkü bunlar bir
 * oturumun *neden bittiğini* değil, bir giriş denemesinin **neden kabul
 * edilmediğini** söyler.
 *
 * `INVALID_CREDENTIALS` tek bir koda karşılık gelir ve gelmelidir: backend
 * yanlış parola ile olmayan hesabı ayırt edilemez kılar (`StaffLoginIT`
 * bunu testle sabitler). Panelin burada iki ayrı mesaj üretmesi, backend'in
 * kapattığı varlık sızıntısını istemcide yeniden açardı.
 */
export const SIGN_IN_FAILURE_CODES = [
  "INVALID_CREDENTIALS",
  "TOO_MANY_ATTEMPTS",
  "BACKEND_UNREACHABLE",
  "MISSING_FIELDS",
  "UNKNOWN",
] as const;

export type SignInFailureCode = (typeof SIGN_IN_FAILURE_CODES)[number];

export function isSignInFailureCode(value: unknown): value is SignInFailureCode {
  return typeof value === "string" && (SIGN_IN_FAILURE_CODES as readonly string[]).includes(value);
}

/** Parola değiştirme ekranının kendi sonuçları. */
export const PASSWORD_CHANGE_FAILURE_CODES = [
  /** Mevcut parola hatalı (backend 401). */
  "CURRENT_PASSWORD_WRONG",
  /** Yeni parola eskisiyle aynı (backend 409). */
  "PASSWORD_UNCHANGED",
  /** Yeni parola backend'in parola politikasını geçmedi (backend 400). */
  "PASSWORD_REJECTED",
  "MISMATCH",
  "MISSING_FIELDS",
  "BACKEND_UNREACHABLE",
  "UNKNOWN",
] as const;

export type PasswordChangeFailureCode = (typeof PASSWORD_CHANGE_FAILURE_CODES)[number];

export function isPasswordChangeFailureCode(value: unknown): value is PasswordChangeFailureCode {
  return (
    typeof value === "string" &&
    (PASSWORD_CHANGE_FAILURE_CODES as readonly string[]).includes(value)
  );
}
