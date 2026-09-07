import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { buildSessionCookie, decodeStaffSession, encodeStaffSession } from "@/server/auth/cookies";
import type { AuthFailureCode } from "@/server/auth/errors";
import { classifyRefreshFailure, isAccessTokenFresh } from "@/server/auth/session";
import { refreshStaffSession } from "@/server/auth/staff-auth-api";

/**
 * Oturum kapısı. Panele gelen her istek buradan geçer.
 *
 * Üç iş yapar ve ikincisi kolayca gözden kaçar:
 *
 *  1. **Anonim isteği geri çevirir.**
 *  2. **Yenilenen çerezi yazan tek yerdir.** Bir Server Component'in yazacağı
 *     bir yanıt yoktur; yalnız burada hem tarayıcıya giden `Set-Cookie` hem de
 *     bu isteğin arkasındaki render'ın göreceği çerez tazelenebilir. Bu dosya
 *     olmadan her istek aynı ölmekte olan token'ı sunmaya devam ederdi.
 *  3. **İlk girişte parola değiştirme adımını dayatır.** Backend o bayrak
 *     açıkken `/admin/**`'ın tamamını — `/admin/me` dâhil — 403'le reddediyor,
 *     yani kişi paneli boş ve sebepsiz görürdü.
 *
 * Node.js çalışma zamanında koşar (Next.js 16'nın `proxy.ts` için varsayılanı);
 * `@/server/api/koala` zaten bunu gerektiriyor.
 *
 * Eş zamanlı iki yenilemeyi eşgüdümleyen bir mekanizma **yok**, ve gerekmiyor:
 * personel yenileme token'ı tek kullanımlık değil. Backend
 * (`StaffAccountManager.refresh`) aynı `tokenVersion` ile yeni bir token üretir
 * ve eskisini geçersiz kılmaz, yani aynı token'ı iki kez harcamak oturumu
 * düşürmez. Uçuş-hâlindeki-istek haritasının kalkma sebebi bu.
 */

const SESSION_COOKIE = buildSessionCookie(env.ADMIN_PUBLIC_ORIGIN);

/**
 * Oturum olmadan ulaşılabilen yollar, her biri gerekçesiyle:
 *
 *  - `/giris` ve `/giris/hata` oturumun başladığı ve neden başlamadığının
 *    anlatıldığı yerler. Bunları kapatmak yönlendirmeyi döngüye sokar ve her
 *    hatayı, bildirmeye çalıştığı hatanın arkasına saklar.
 *
 * `/api/health` (yük dengeleyici çerezsiz çağırır) bu fonksiyona hiç gelmez;
 * aşağıdaki matcher onu dışarıda bırakır.
 */
const PUBLIC_PATHS: readonly string[] = ["/giris", "/giris/hata"];

/** Oturum ister ama izin istemez: parolasını değiştirmesi gereken kişinin gidebildiği tek yer. */
const PASSWORD_CHANGE_PATH = "/giris/parola";

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.includes(pathname);
}

export default async function proxy(request: NextRequest): Promise<NextResponse> {
  const { pathname, search } = request.nextUrl;

  if (isPublic(pathname)) {
    return NextResponse.next();
  }

  const session = decodeStaffSession(request.cookies.get(SESSION_COOKIE.name)?.value);

  if (session === null) {
    return redirectToSignIn(request, `${pathname}${search}`);
  }

  if (session.mustChangePassword) {
    /**
     * Bayrak açıkken paneldeki hiçbir sayfa çalışmaz. Kişiyi tek çalışan
     * ekrana götürmek, ona her sayfada ayrı bir 403 göstermekten iyidir.
     */
    return pathname === PASSWORD_CHANGE_PATH
      ? NextResponse.next()
      : NextResponse.redirect(new URL(PASSWORD_CHANGE_PATH, request.nextUrl.origin));
  }

  if (pathname === PASSWORD_CHANGE_PATH) {
    // Bayrak inmiş; burada yapacak bir şey kalmadı.
    return NextResponse.redirect(new URL("/", request.nextUrl.origin));
  }

  if (session.refreshExpiresAt <= Date.now()) {
    // Yenileme token'ının da ömrü dolmuş: elde oturuma benzeyen ama hiçbir işe
    // yaramayan bir çerez var. Düşür ve kimseyi yarım giriş yapmış bırakma.
    return dropSessionAndSignIn(request, `${pathname}${search}`);
  }

  if (isAccessTokenFresh(session)) {
    return NextResponse.next();
  }

  try {
    const refreshed = await refreshStaffSession(session.refreshToken);
    const value = encodeStaffSession(refreshed);

    /**
     * Çerez iki yere birden yazılıyor. `request.cookies.set` bu isteğin
     * arkasındaki render'ın göreceği çerezi tazeler; `response.cookies.set`
     * tarayıcıya gider. Yalnız ikincisini yazmak, render'ın hâlâ ölmüş token'ı
     * kullanması demekti.
     */
    request.cookies.set(SESSION_COOKIE.name, value);
    const response = NextResponse.next({ request: { headers: request.headers } });
    response.cookies.set(SESSION_COOKIE.name, value, {
      ...SESSION_COOKIE.options,
      expires: new Date(refreshed.refreshExpiresAt),
    });

    // Parola sıfırlanmış olabilir: bayrak yenileme yanıtıyla da gelir.
    return refreshed.mustChangePassword
      ? NextResponse.redirect(new URL(PASSWORD_CHANGE_PATH, request.nextUrl.origin), {
          headers: response.headers,
        })
      : response;
  } catch (error) {
    /**
     * Yenileme başarısız — ve **hangi** başarısızlık olduğu, kişiye söylenecek
     * şeyi tersine çeviriyor:
     *
     *  - **401** oturumun bittiği anlamına gelir. Backend'de `tokenVersion`'ı
     *    artıran üç yol var (çıkış, kendi parolasını değiştirme, bir yöneticinin
     *    parolayı sıfırlaması) ve üçü de açık bütün token'ları anında öldürür.
     *    Yani bu, bekleneni yapan bir sistemin normal sonucu. Buna
     *    "Koala'ya ulaşılamıyor" demek, meslektaşı parolasını sıfırladığı için
     *    oturumu düşen kişiyi backend'in ayakta olup olmadığını doğrulamaya
     *    gönderirdi.
     *  - **Ulaşılamamak** (taşıma hatası ya da 5xx) gerçekten "sizinle ilgili
     *    değil" demek; oturum hâlâ geçerli olabilir.
     *
     * Ayrımı burada yeniden yazmıyoruz: `classifyRefreshFailure` `session.ts`'te
     * zaten var ve tek doğru olarak kalması gereken şey o.
     *
     * Çerez yalnız 401'de düşüyor. Reddedilen bir yenileme token'ı, ömrü dolmuş
     * olanla aynı ölçüde işe yaramaz (yukarıdaki `dropSessionAndSignIn` ile aynı
     * gerekçe); ulaşılamamakta ise çerezi tutmak bir sonraki istekte yeniden
     * denemeyi mümkün kılar.
     */
    const { code } = classifyRefreshFailure(error);
    const response = redirectToAuthError(request, code);

    if (code === "SESSION_EXPIRED") {
      response.cookies.set(SESSION_COOKIE.name, "", { ...SESSION_COOKIE.options, maxAge: 0 });
    }

    return response;
  }
}

function redirectToSignIn(request: NextRequest, callbackUrl: string): NextResponse {
  const signIn = new URL("/giris", request.nextUrl.origin);
  signIn.searchParams.set("callbackUrl", callbackUrl);
  return NextResponse.redirect(signIn);
}

function dropSessionAndSignIn(request: NextRequest, callbackUrl: string): NextResponse {
  const response = redirectToSignIn(request, callbackUrl);
  response.cookies.set(SESSION_COOKIE.name, "", { ...SESSION_COOKIE.options, maxAge: 0 });
  return response;
}

/**
 * `/giris/hata`, her koda kendi cümlesini yazan sayfa. Kod oraya olduğu gibi
 * geçiyor: metni burada üretmek, aynı açıklamanın ikinci bir kopyasını yaratıp
 * ikisinin ayrışmasını beklemek olurdu.
 */
function redirectToAuthError(request: NextRequest, code: AuthFailureCode): NextResponse {
  const target = new URL("/giris/hata", request.nextUrl.origin);
  target.searchParams.set("kod", code);
  return NextResponse.redirect(target);
}

export const config = {
  matcher: [
    /**
     * Her şey, şunlar hariç:
     *  - `api/health` — çerezsiz çağrılan canlılık yoklaması.
     *  - Next.js derleme çıktısı ve favicon; korunacak bir şey taşımazlar ve
     *    aksi hâlde her varlık için bir oturum okuması yaparlardı.
     */
    "/((?!api/health|_next/static|_next/image|favicon.ico).*)",
  ],
};
