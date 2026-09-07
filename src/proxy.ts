import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/env";
import { buildSessionCookie, decodeStaffSession, encodeStaffSession } from "@/server/auth/cookies";
import { isAccessTokenFresh } from "@/server/auth/session";
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
  } catch {
    /**
     * Yenileme başarısız. İki sebep olabilir ve ayırt etmenin bedeli, ayırt
     * etmemenin bedelinden büyük: reddedildiyse oturum bitmiştir, backend
     * cevap vermediyse oturum hâlâ geçerli olabilir. Her iki hâlde de erişim
     * token'ı kullanılamaz durumda, ve çerezi tutmak bir sonraki istekte
     * yeniden denemeyi mümkün kılar — bu yüzden çerez düşürülmüyor, kişi
     * sebebi yazan sayfaya gönderiliyor.
     *
     * Oturumun gerçekten bittiği hâli `getKoalaAccessToken()` `SESSION_EXPIRED`
     * olarak ayırt eder ve gate oradan `/giris`e yönlendirir.
     */
    return NextResponse.redirect(
      new URL("/giris/hata?kod=BACKEND_UNREACHABLE", request.nextUrl.origin),
    );
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
