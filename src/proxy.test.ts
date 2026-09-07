import { HttpResponse, http } from "msw";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../test/msw";

import { buildSessionCookie, encodeStaffSession, type StaffSession } from "@/server/auth/cookies";

import proxy from "./proxy";

/**
 * Oturum kapısı, gerçekten kapı olarak ölçülüyor.
 *
 * Bu dosyadaki iddiaların hiçbiri "giriş ekranı çiziliyor" değil. Her biri bir
 * **yönlendirme** ya da bir **`Set-Cookie`** üzerinde duruyor, çünkü kapının
 * kapalı olduğunu söyleyen şey ekranın görüntüsü değil, isteğin nereye
 * gittiğidir.
 *
 * Yenileme ucu MSW ile taklit ediliyor ama `refreshStaffSession` gerçek:
 * gövde biçimi, zarf çözümü ve hata sınıflandırması test edilen yolun içinde
 * kalıyor. Mock'lansaydı, biçim değiştiğinde bu testler yeşil kalırdı.
 */

const COOKIE = buildSessionCookie("http://localhost:3000");
const REFRESH = apiUrl("/admin/auth/refresh");

const HOUR = 60 * 60 * 1000;

function session(overrides: Partial<StaffSession> = {}): StaffSession {
  return {
    accessToken: "access-token",
    refreshToken: "refresh-token",
    accessExpiresAt: Date.now() + 15 * 60 * 1000,
    refreshExpiresAt: Date.now() + 12 * HOUR,
    mustChangePassword: false,
    ...overrides,
  };
}

function request(pathname: string, staffSession: StaffSession | null): NextRequest {
  const next = new NextRequest(new URL(pathname, "http://localhost:3000"));
  if (staffSession !== null) {
    next.cookies.set(COOKIE.name, encodeStaffSession(staffSession));
  }
  return next;
}

/** The `Set-Cookie` this response writes for the session cookie, if any. */
function setCookie(response: Response): string | null {
  return (
    response.headers.getSetCookie().find((header) => header.startsWith(`${COOKIE.name}=`)) ?? null
  );
}

function tokenEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    message: "Token yenilendi.",
    httpStatus: "200 OK",
    path: "/admin/auth/refresh",
    requestId: "rid-refresh",
    timeStamp: "2026-09-08T09:00:00.000000000Z",
    data: {
      accessToken: "fresh-access-token",
      refreshToken: "fresh-refresh-token",
      accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 12 * HOUR).toISOString(),
      mustChangePassword: false,
      ...overrides,
    },
  };
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a request with no token", () => {
  it("never reaches a protected page", async () => {
    const response = await proxy(request("/audit-log", null));

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location") ?? "");
    expect(location.pathname).toBe("/giris");
    // Nereden geldiği taşınıyor, çünkü giriş yaptıktan sonra kişinin gitmek
    // istediği yere dönmesi gerekiyor.
    expect(location.searchParams.get("callbackUrl")).toBe("/audit-log");
  });

  it("is turned away from a Server Action's own URL too", async () => {
    // Bir Server Action, formu çizen sayfanın kapısını kullanmaz; kendi URL'i
    // vardır ve POST olarak gelir. Kapı buradan da geçmeli.
    const post = new NextRequest(new URL("/companies", "http://localhost:3000"), {
      method: "POST",
    });

    expect((await proxy(post)).status).toBe(307);
  });

  it("still lets the sign-in surfaces through, or the redirect would loop", async () => {
    for (const path of ["/giris", "/giris/hata"]) {
      const response = await proxy(request(path, null));
      expect(response.status, path).toBe(200);
    }
  });

  it("is not fooled by a cookie that is not a session", async () => {
    // Çerezi kendi eliyle yazabilen biri en fazla geçersiz bir şey uydurabilir;
    // çözücü bunu "oturum yok" olarak okumak zorunda, yarım bir oturum olarak
    // değil.
    for (const value of ["", "cöp", btoa('{"accessToken":""}')]) {
      const next = new NextRequest(new URL("/audit-log", "http://localhost:3000"));
      next.cookies.set(COOKIE.name, value);

      expect((await proxy(next)).status, value).toBe(307);
    }
  });
});

describe("a token that is no longer usable", () => {
  it("is refused when the backend rejects the refresh, and nothing is let through", async () => {
    // Erişim token'ı ölmüş, yenileme reddedildi: parola değişmiş, çıkış
    // yapılmış ya da hesap kapatılmış olabilir. Üçü de oturumun bitmesi demek.
    let calls = 0;
    server.use(
      http.post(REFRESH, () => {
        calls += 1;
        return HttpResponse.json(
          {
            success: false,
            message: "Oturum sonlandırılmış.",
            httpStatus: "401 UNAUTHORIZED",
            errorCode: "STAFF_SESSION_ENDED",
            errorCategory: "TOKEN_EXPIRED",
            path: "/admin/auth/refresh",
            requestId: "rid-dead",
            timeStamp: "2026-09-08T09:00:00.000000000Z",
          },
          { status: 401 },
        );
      }),
    );

    const response = await proxy(
      request("/audit-log", session({ accessExpiresAt: Date.now() - 1000 })),
    );

    expect(calls).toBe(1);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/giris/hata?kod=BACKEND_UNREACHABLE");
  });

  it("drops the cookie outright once the refresh token is past its life", async () => {
    // Burada backend'e gitmenin anlamı yok: elde oturuma benzeyen ama hiçbir işe
    // yaramayan bir çerez var, ve onu bırakmak kişiyi yarım giriş yapmış
    // gösterirdi.
    const response = await proxy(
      request(
        "/audit-log",
        session({ accessExpiresAt: Date.now() - HOUR, refreshExpiresAt: Date.now() - 1000 }),
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toContain("/giris");

    const dropped = setCookie(response);
    expect(dropped).not.toBeNull();
    expect(dropped).toMatch(/Max-Age=0/i);
    expect(dropped).toContain("HttpOnly");
  });

  it("is renewed and written back when the refresh succeeds", async () => {
    server.use(http.post(REFRESH, () => HttpResponse.json(tokenEnvelope())));

    const response = await proxy(
      request("/audit-log", session({ accessExpiresAt: Date.now() - 1000 })),
    );

    expect(response.status).toBe(200);

    const written = setCookie(response);
    expect(written).not.toBeNull();
    // Çerez tarayıcıya inecek ama JavaScript'ine hiç görünmeyecek.
    expect(written).toContain("HttpOnly");
    expect(written).toContain("SameSite=lax");
    expect(written).toContain("Path=/");
  });

  it("does not spend a refresh on a token that is still fresh", async () => {
    let calls = 0;
    server.use(
      http.post(REFRESH, () => {
        calls += 1;
        return HttpResponse.json(tokenEnvelope());
      }),
    );

    const response = await proxy(request("/audit-log", session()));

    expect(response.status).toBe(200);
    expect(calls).toBe(0);
    expect(setCookie(response)).toBeNull();
  });
});

describe("an account that has to change its password first", () => {
  it("reaches the password screen and nothing else", async () => {
    // Backend bu bayrak açıkken /admin/me dâhil her ucu 403'le reddediyor, yani
    // panelin geri kalanı kişiye boş ve sebepsiz görünürdü.
    const flagged = session({ mustChangePassword: true });

    const blocked = await proxy(request("/audit-log", flagged));
    expect(blocked.status).toBe(307);
    expect(blocked.headers.get("location")).toContain("/giris/parola");

    const allowed = await proxy(request("/giris/parola", flagged));
    expect(allowed.status).toBe(200);
  });

  it("sends a cleared account away from the password screen", async () => {
    const response = await proxy(request("/giris/parola", session()));

    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location") ?? "").pathname).toBe("/");
  });
});
