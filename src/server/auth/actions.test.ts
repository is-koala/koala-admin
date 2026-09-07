import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { decodeStaffSession, encodeStaffSession, type StaffSession } from "./cookies";

/**
 * Giriş, çıkış ve parola değiştirme — çerez üzerinden ölçülüyor.
 *
 * Buradaki iddialar ekranla değil `Set-Cookie` ve istek sayısıyla kurulu.
 * "Çıkış yapıldı" bir ekran mesajı değil, iki olaydır: çerezin gerçekten
 * düşmesi ve backend'in token sürümünü artırması. Yalnız birincisi olursa
 * panel sizi unutur ve token ömrü dolana kadar geçerli kalır — görünmeyen bir
 * hata.
 */

interface WrittenCookie {
  name: string;
  value: string;
  options: Record<string, unknown>;
}

const jar = new Map<string, string>();
let written: WrittenCookie[] = [];

vi.mock("next/headers", () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) as string } : undefined),
      set: (name: string, value: string, options: Record<string, unknown>) => {
        written.push({ name, value, options });
        if (value === "") jar.delete(name);
        else jar.set(name, value);
      },
    }),
}));

const { SESSION_COOKIE_NAME } = await import("./session");
const { changeOwnPassword, signInWithPassword, signOut } = await import("./actions");

const LOGIN = apiUrl("/admin/auth/login");
const LOGOUT = apiUrl("/admin/auth/logout");
const PASSWORD = apiUrl("/admin/auth/password");

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

function signedIn(overrides: Partial<StaffSession> = {}): void {
  jar.set(SESSION_COOKIE_NAME, encodeStaffSession(session(overrides)));
}

/** Server Action'lar `redirect()` ile biter; hedef `digest` üzerinde taşınır. */
async function destinationOf(run: Promise<void>): Promise<string> {
  try {
    await run;
    return "no-redirect";
  } catch (error) {
    return (error as { digest?: string }).digest ?? `other: ${String(error)}`;
  }
}

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.append(key, value);
  return data;
}

function loginEnvelope(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    message: "Giriş yapıldı.",
    httpStatus: "200 OK",
    path: "/admin/auth/login",
    requestId: "rid-login",
    timeStamp: "2026-09-08T09:00:00.000000000Z",
    data: {
      accessToken: "ACCESS-FROM-BACKEND",
      refreshToken: "REFRESH-FROM-BACKEND",
      accessExpiresAt: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
      refreshExpiresAt: new Date(Date.now() + 12 * HOUR).toISOString(),
      mustChangePassword: false,
      ...overrides,
    },
  };
}

function refusal(status: number, errorCode: string, errorCategory: string, path: string) {
  return HttpResponse.json(
    {
      success: false,
      message: "Reddedildi.",
      httpStatus: `${status}`,
      errorCode,
      errorCategory,
      path,
      requestId: "rid-refused",
      timeStamp: "2026-09-08T09:00:00.000000000Z",
    },
    { status },
  );
}

beforeEach(() => {
  jar.clear();
  written = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signing in", () => {
  it("puts the tokens in an HttpOnly cookie and nowhere else", async () => {
    server.use(http.post(LOGIN, () => HttpResponse.json(loginEnvelope())));

    const destination = await destinationOf(
      signInWithPassword("/audit-log", form({ email: "owner@iskoala.com", password: "gizli" })),
    );

    expect(destination).toContain("/audit-log");

    const cookie = written.at(-1);
    expect(cookie?.name).toBe(SESSION_COOKIE_NAME);
    expect(cookie?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    expect(decodeStaffSession(cookie?.value)?.accessToken).toBe("ACCESS-FROM-BACKEND");

    // Ve hiçbir token yönlendirme adresine sızmıyor: URL sunucu günlüğüne,
    // tarayıcı geçmişine ve Referer başlığına düşer.
    expect(destination).not.toContain("ACCESS-FROM-BACKEND");
    expect(destination).not.toContain("REFRESH-FROM-BACKEND");
  });

  it("writes neither the e-mail nor the password into the failure URL", async () => {
    server.use(
      http.post(LOGIN, () =>
        refusal(401, "STAFF_LOGIN_FAILED", "INVALID_CREDENTIALS", "/admin/auth/login"),
      ),
    );

    const destination = await destinationOf(
      signInWithPassword(undefined, form({ email: "owner@iskoala.com", password: "gizli" })),
    );

    expect(destination).toContain("hata=INVALID_CREDENTIALS");
    expect(destination).not.toContain("owner@iskoala.com");
    expect(destination).not.toContain("gizli");
    // Reddedilen bir giriş çerez bırakmaz.
    expect(written).toEqual([]);
  });

  it("sends an account with the first-login flag to the only screen that works", async () => {
    server.use(
      http.post(LOGIN, () => HttpResponse.json(loginEnvelope({ mustChangePassword: true }))),
    );

    const destination = await destinationOf(
      signInWithPassword("/audit-log", form({ email: "owner@iskoala.com", password: "gizli" })),
    );

    expect(destination).toContain("/giris/parola");
    expect(destination).not.toContain("/audit-log");
  });

  it("refuses an absolute callbackUrl instead of turning the form into an open redirect", async () => {
    server.use(http.post(LOGIN, () => HttpResponse.json(loginEnvelope())));

    for (const hostile of ["https://evil.example/", "//evil.example/"]) {
      const destination = await destinationOf(
        signInWithPassword(hostile, form({ email: "o@iskoala.com", password: "gizli" })),
      );

      expect(destination, hostile).not.toContain("evil.example");
    }
  });

  it("never reaches the backend with a half-filled form", async () => {
    let calls = 0;
    server.use(
      http.post(LOGIN, () => {
        calls += 1;
        return HttpResponse.json(loginEnvelope());
      }),
    );

    await destinationOf(signInWithPassword(undefined, form({ email: "", password: "gizli" })));

    expect(calls).toBe(0);
  });
});

describe("signing out", () => {
  it("drops the cookie and ends the session on the backend", async () => {
    signedIn();
    let authorization: string | null = null;
    server.use(
      http.post(LOGOUT, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          message: "Çıkış yapıldı.",
          httpStatus: "200 OK",
          path: "/admin/auth/logout",
          requestId: "rid-logout",
          timeStamp: "2026-09-08T09:00:00.000000000Z",
        });
      }),
    );

    const destination = await destinationOf(signOut());

    // Yerel yarım: çerez gerçekten düşüyor.
    const dropped = written.at(-1);
    expect(dropped?.name).toBe(SESSION_COOKIE_NAME);
    expect(dropped?.value).toBe("");
    expect(dropped?.options).toMatchObject({ maxAge: 0, httpOnly: true });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);

    // Sunucu yarımı: token sürümü artsın diye backend çağrılıyor. Yalnız
    // çerezi silmek, panelin sizi unutması ama token'ın geçerli kalması olurdu.
    expect(authorization).toBe("Bearer access-token");
    expect(destination).toContain("/giris");
  });

  it("still drops the cookie when the backend refuses the call", async () => {
    signedIn();
    server.use(http.post(LOGOUT, () => HttpResponse.error()));

    await destinationOf(signOut());

    expect(written.at(-1)?.options).toMatchObject({ maxAge: 0 });
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(false);
  });

  it("is harmless with no session at all", async () => {
    let calls = 0;
    server.use(
      http.post(LOGOUT, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );

    expect(await destinationOf(signOut())).toContain("/giris");
    expect(calls).toBe(0);
  });
});

describe("changing your own password", () => {
  it("drops the cookie afterwards, because the backend has just killed the token", async () => {
    signedIn({ mustChangePassword: true });
    server.use(
      http.post(PASSWORD, () =>
        HttpResponse.json({
          success: true,
          message: "Parola güncellendi.",
          httpStatus: "200 OK",
          path: "/admin/auth/password",
          requestId: "rid-password",
          timeStamp: "2026-09-08T09:00:00.000000000Z",
        }),
      ),
    );

    const destination = await destinationOf(
      changeOwnPassword(
        form({
          currentPassword: "eski",
          newPassword: "Yeni-Parola-1",
          newPasswordRepeat: "Yeni-Parola-1",
        }),
      ),
    );

    expect(written.at(-1)?.options).toMatchObject({ maxAge: 0 });
    expect(destination).toContain("/giris?bilgi=PASSWORD_CHANGED");
  });

  it("never sends a mismatched pair to the backend", async () => {
    signedIn({ mustChangePassword: true });
    let calls = 0;
    server.use(
      http.post(PASSWORD, () => {
        calls += 1;
        return HttpResponse.error();
      }),
    );

    const destination = await destinationOf(
      changeOwnPassword(
        form({ currentPassword: "eski", newPassword: "bir", newPasswordRepeat: "baska" }),
      ),
    );

    expect(calls).toBe(0);
    expect(destination).toContain("hata=MISMATCH");
    // Ve oturum yerinde kalıyor: yanlış yazılan bir tekrar, kişiyi dışarı atmaz.
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(true);
  });

  it("keeps the session when the backend refuses, and names the reason", async () => {
    signedIn({ mustChangePassword: true });
    server.use(
      http.post(PASSWORD, () =>
        refusal(401, "STAFF_LOGIN_FAILED", "INVALID_CREDENTIALS", "/admin/auth/password"),
      ),
    );

    const destination = await destinationOf(
      changeOwnPassword(
        form({ currentPassword: "yanlis", newPassword: "Yeni-1", newPasswordRepeat: "Yeni-1" }),
      ),
    );

    expect(destination).toContain("hata=CURRENT_PASSWORD_WRONG");
    expect(jar.has(SESSION_COOKIE_NAME)).toBe(true);
  });
});
