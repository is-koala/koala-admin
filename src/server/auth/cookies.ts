/**
 * Oturum çerezi: adı, bayrakları ve içine ne konduğu.
 *
 * Çerez, Koala'nın personel token'larını taşır ve **tarayıcı JavaScript'i onu
 * hiç göremez**. `httpOnly` bunun tek garantisi: panelin izin kümesinde
 * `payout.release` var, yani token'ı okuyabilen bir XSS emanetten para
 * çıkarabilir. Bayraklar varsayılana bırakılmıyor, çünkü varsayılan bir
 * incelemede parmakla gösterilemez; `cookies.test.ts` üçünü de doğruluyor.
 *
 * ### Neden şifrelenmiyor?
 *
 * Auth.js dönemi çerezi bir JWE idi ve `AUTH_SECRET` gerektiriyordu. Burada
 * şifreleme bir şey satın almıyor: çerezin içeriği **zaten kimlik bilgisinin
 * kendisi** — backend'in imzaladığı bir bearer token. Onu, yanı başında duran
 * bir anahtarla şifrelemek sırrı korumaz, yalnız yönetilecek bir sır daha
 * ekler. Çerezi okuyabilen taraf her iki hâlde de aynı yetkiye sahiptir.
 *
 * Aynı sebeple imzalanmıyor da: çerezi kendi eliyle değiştirebilen biri en
 * fazla geçersiz bir token uydurabilir, ki backend onu reddeder ve kişi giriş
 * sayfasına düşer — çerezi silmekle aynı sonuç. İçeriği uydurmak, backend'in
 * HMAC anahtarını uydurmak demektir.
 */

/**
 * Çerezde duran her şey. Kişiye dair hiçbir şey burada değil: ad, rol ve izinler
 * her istekte `/admin/me`'den okunur (ADR-0010'un ADR-0014'ün de devraldığı
 * yarısı). Buraya bir izin listesi koymak, tam olarak o ADR'nin taşıdığı
 * bayatlığı geri getirirdi.
 */
export interface StaffSession {
  readonly accessToken: string;
  readonly refreshToken: string;
  /** Epoch **milisaniye**. Backend `Instant` olarak yollar, burada sayıya çevrilir. */
  readonly accessExpiresAt: number;
  /** Epoch milisaniye. Bu geçtikten sonra yenileme de mümkün değil. */
  readonly refreshExpiresAt: number;
  /**
   * Backend'in giriş yanıtındaki bayrak. Bu doğruyken backend `/admin/**`'ın
   * tamamını 403'le reddeder (`StaffPermissionAuthorizationManager.decideForStaff`),
   * parola değiştirme ucu hariç — yani `/admin/me` de cevap vermez. Bu yüzden
   * bayrağın tek kaynağı giriş yanıtı olmak zorunda ve çerezde durmak zorunda.
   *
   * Bir kapı değil, bir yön levhası: kararı backend veriyor, panel yalnız
   * kişiyi doğru ekrana götürüyor.
   */
  readonly mustChangePassword: boolean;
}

/** Temel ad. `__Secure-` öneki yalnız güvenli çerezde yasaldır, aşağıya bak. */
const BASE_NAME = "koala_admin_session";

export interface SessionCookieDefinition {
  readonly name: string;
  readonly options: {
    readonly httpOnly: true;
    readonly sameSite: "lax";
    readonly path: "/";
    readonly secure: boolean;
  };
}

/**
 * `secure`, panelin kendi şemasını izler ve izlemek zorunda.
 *
 * `Secure` işaretli bir çerez düz HTTP üzerinde tarayıcı tarafından hiç
 * saklanmaz; sabit `true` yazmak yereli sertleştirmez, yerel girişi imkânsız
 * kılar ve birini bayrağı tamamen kapatmaya iter. `ADMIN_PUBLIC_ORIGIN`
 * `src/env.ts` içinde localhost dışında https olmaya zorlanır, dolayısıyla
 * canlıda `https` bir umut değil: `http://admin.iskoala.com` hiç açılmaz.
 *
 * `sameSite: "lax"` — `strict` değil. OIDC yönlendirmesi kalktığı için eski
 * gerekçe düştü, ama yenisi var: `strict` çerezi başka bir yerden gelen
 * üst-seviye gezinmede de göndermez, yani panele bir bağlantıyla giren herkes
 * önce giriş sayfasına düşer. `lax` siteler arası POST'u zaten engelliyor ve
 * Next.js Server Action'ları ayrıca origin doğrulaması yapıyor.
 */
export function buildSessionCookie(publicOrigin: string): SessionCookieDefinition {
  const secure = publicOrigin.startsWith("https:");

  return {
    name: secure ? `__Secure-${BASE_NAME}` : BASE_NAME,
    options: {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure,
    },
  };
}

/**
 * Çerez değeri: base64url'lenmiş JSON.
 *
 * base64url, ham JSON'un içindeki `{`, `"` ve `,` karakterlerini çerez
 * dilbilgisinden çıkarır — aksi hâlde değeri tırnaklamak gerekir ve tırnaklama
 * kuralları sunucu ile tarayıcı arasında sessizce ayrışabilir.
 */
export function encodeStaffSession(session: StaffSession): string {
  return toBase64Url(JSON.stringify(session));
}

/**
 * Çerezi geri oku, ya da `null`.
 *
 * Her başarısızlık `null` — bozuk, eksik alanlı ya da başka bir şema ile
 * yazılmış bir çerez "oturum yok" demektir. Yarım bir oturum döndürmek, kapıyı
 * açık bırakmanın en sessiz yoludur.
 */
export function decodeStaffSession(value: string | undefined | null): StaffSession | null {
  if (typeof value !== "string" || value.length === 0) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(fromBase64Url(value)) as unknown;
  } catch {
    return null;
  }

  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;

  const accessToken = record.accessToken;
  const refreshToken = record.refreshToken;
  const accessExpiresAt = record.accessExpiresAt;
  const refreshExpiresAt = record.refreshExpiresAt;

  if (typeof accessToken !== "string" || accessToken.length === 0) return null;
  if (typeof refreshToken !== "string" || refreshToken.length === 0) return null;
  if (typeof accessExpiresAt !== "number" || !Number.isFinite(accessExpiresAt)) return null;
  if (typeof refreshExpiresAt !== "number" || !Number.isFinite(refreshExpiresAt)) return null;

  return {
    accessToken,
    refreshToken,
    accessExpiresAt,
    refreshExpiresAt,
    // Eksikse `true` değil `false`: bayrak yalnız yönlendirme içindir ve kapıyı
    // backend tutar. Eksik bir alan yüzünden herkesi parola ekranına kilitlemek,
    // hiçbir şeyi korumadan paneli kullanılamaz hâle getirirdi.
    mustChangePassword: record.mustChangePassword === true,
  };
}

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): string {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return new TextDecoder().decode(Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)));
}
