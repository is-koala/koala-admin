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

const { SESSION_COOKIE_NAME, isAccessTokenFresh } = await import("./session");
const { changeOwnPassword, signInWithPassword, signOut } = await import("./actions");

const LOGIN = apiUrl("/admin/auth/login");
const LOGOUT = apiUrl("/admin/auth/logout");
const PASSWORD = apiUrl("/admin/auth/password");
const REFRESH = apiUrl("/admin/auth/refresh");

const HOUR = 60 * 60 * 1000;
const ACCESS_TOKEN_SENTINEL = "ACCESS-FROM-BACKEND";
const REFRESH_TOKEN_SENTINEL = "REFRESH-FROM-BACKEND";

const hostileCallbacks = [
  ["absolute URL", "https://evil.example/absolute"],
  ["scheme-relative URL", "//evil.example/scheme-relative"],
  ["literal backslash", "/\\evil.example/literal-backslash"],
  ["percent-encoded backslash", "/%5Cevil.example/encoded-backslash"],
  ["double-encoded backslash", "/%255Cevil.example/double-encoded-backslash"],
  ["literal control", "/\n/evil.example/literal-control"],
  ["percent-encoded control", "/%0A/evil.example/encoded-control"],
  ["double-encoded control", "/%250A/evil.example/double-encoded-control"],
  ["literal C1 next-line control", "/\u0085/evil.example/literal-c1-next-line"],
  ["literal C1 application control", "/\u009F/evil.example/literal-c1-application"],
  ["percent-encoded C1 next-line control", "/%C2%85/evil.example/encoded-c1-next-line"],
  ["percent-encoded C1 application control", "/%C2%9F/evil.example/encoded-c1-application"],
  ["double-encoded C1 next-line control", "/%25C2%2585/evil.example/double-encoded-c1-next-line"],
  [
    "double-encoded C1 application control",
    "/%25C2%259F/evil.example/double-encoded-c1-application",
  ],
  ["percent-encoded scheme-relative URL", "/%2Fevil.example/encoded-scheme-relative"],
  ["double-encoded scheme-relative URL", "/%252Fevil.example/double-encoded-scheme-relative"],
] as const;

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

function capturedLogs(): string {
  return [...vi.mocked(console.error).mock.calls, ...vi.mocked(console.warn).mock.calls]
    .flat()
    .join(" ");
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
      accessToken: ACCESS_TOKEN_SENTINEL,
      refreshToken: REFRESH_TOKEN_SENTINEL,
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

  it("falls back without reflecting hostile callback URLs into the redirect or logs", async () => {
    server.use(http.post(LOGIN, () => HttpResponse.json(loginEnvelope())));

    for (const [label, hostile] of hostileCallbacks) {
      const destination = await destinationOf(
        signInWithPassword(hostile, form({ email: "o@iskoala.com", password: "gizli" })),
      );

      expect(destination, label).toMatch(/^NEXT_REDIRECT;(?:push|replace);\/;30[378];$/);
      expect(destination, label).not.toContain("evil.example");

      const session = decodeStaffSession(written.at(-1)?.value);
      expect(session?.accessToken, label).toBe(ACCESS_TOKEN_SENTINEL);
      expect(session?.refreshToken, label).toBe(REFRESH_TOKEN_SENTINEL);

      const externallyVisible = `${destination}\n${capturedLogs()}`;
      expect(externallyVisible, label).not.toContain("evil.example");
      expect(externallyVisible, label).not.toContain(ACCESS_TOKEN_SENTINEL);
      expect(externallyVisible, label).not.toContain(REFRESH_TOKEN_SENTINEL);
    }
  });

  it("rejects encoded backslashes and controls after the real URL parsing boundary", async () => {
    server.use(http.post(LOGIN, () => HttpResponse.json(loginEnvelope())));

    const urlBoundaryCases = [
      ["encoded on the wire", "/%5Cevil.example/wire-encoded", "/\\evil.example/wire-encoded"],
      [
        "double-encoded on the wire",
        "/%255Cevil.example/wire-double",
        "/%5Cevil.example/wire-double",
      ],
      [
        "double-encoded at the action boundary",
        "/%25255Cevil.example/action-double",
        "/%255Cevil.example/action-double",
      ],
      [
        "literal C1 next-line on the wire",
        "/\u0085/evil.example/wire-literal-c1-next-line",
        "/\u0085/evil.example/wire-literal-c1-next-line",
      ],
      [
        "encoded C1 next-line on the wire",
        "/%C2%85/evil.example/wire-encoded-c1-next-line",
        "/\u0085/evil.example/wire-encoded-c1-next-line",
      ],
      [
        "double-encoded C1 next-line on the wire",
        "/%25C2%2585/evil.example/wire-double-c1-next-line",
        "/%C2%85/evil.example/wire-double-c1-next-line",
      ],
      [
        "double-encoded C1 next-line at the action boundary",
        "/%2525C2%252585/evil.example/action-double-c1-next-line",
        "/%25C2%2585/evil.example/action-double-c1-next-line",
      ],
      [
        "literal C1 application control on the wire",
        "/\u009F/evil.example/wire-literal-c1-application",
        "/\u009F/evil.example/wire-literal-c1-application",
      ],
      [
        "encoded C1 application control on the wire",
        "/%C2%9F/evil.example/wire-encoded-c1-application",
        "/\u009F/evil.example/wire-encoded-c1-application",
      ],
      [
        "double-encoded C1 application control on the wire",
        "/%25C2%259F/evil.example/wire-double-c1-application",
        "/%C2%9F/evil.example/wire-double-c1-application",
      ],
      [
        "double-encoded C1 application control at the action boundary",
        "/%2525C2%25259F/evil.example/action-double-c1-application",
        "/%25C2%259F/evil.example/action-double-c1-application",
      ],
    ] as const;

    for (const [label, wireCallback, actionCallback] of urlBoundaryCases) {
      const signInUrl = new URL(`https://admin.iskoala.com/giris?callbackUrl=${wireCallback}`);
      const parsedCallback = signInUrl.searchParams.get("callbackUrl") ?? undefined;

      expect(parsedCallback, label).toBe(actionCallback);

      const destination = await destinationOf(
        signInWithPassword(parsedCallback, form({ email: "o@iskoala.com", password: "gizli" })),
      );

      expect(destination, label).toMatch(/^NEXT_REDIRECT;(?:push|replace);\/;30[378];$/);
      expect(destination, label).not.toContain("evil.example");
    }
  });

  it("does not reflect hostile callbacks across sign-in failure paths", async () => {
    let validationBackendCalls = 0;

    const failurePaths = [
      {
        label: "action validation",
        errorCode: "MISSING_FIELDS",
        formData: () => form({ email: "", password: "gizli" }),
        arrange: () =>
          server.use(
            http.post(LOGIN, () => {
              validationBackendCalls += 1;
              return HttpResponse.json(loginEnvelope());
            }),
          ),
        expectsFailureLog: false,
      },
      {
        label: "backend 401",
        errorCode: "INVALID_CREDENTIALS",
        formData: () => form({ email: "o@iskoala.com", password: "gizli" }),
        arrange: () =>
          server.use(
            http.post(LOGIN, () =>
              refusal(401, "STAFF_LOGIN_FAILED", "INVALID_CREDENTIALS", "/admin/auth/login"),
            ),
          ),
        expectsFailureLog: true,
      },
      {
        label: "transport failure",
        errorCode: "BACKEND_UNREACHABLE",
        formData: () => form({ email: "o@iskoala.com", password: "gizli" }),
        arrange: () => server.use(http.post(LOGIN, () => HttpResponse.error())),
        expectsFailureLog: true,
      },
    ] as const;

    for (const failurePath of failurePaths) {
      failurePath.arrange();

      for (const [callbackLabel, hostile] of hostileCallbacks) {
        vi.mocked(console.error).mockClear();
        vi.mocked(console.warn).mockClear();

        const destination = await destinationOf(
          signInWithPassword(hostile, failurePath.formData()),
        );
        const logs = capturedLogs();
        const assertionLabel = `${failurePath.label}: ${callbackLabel}`;

        expect(hostile, assertionLabel).toContain("evil.example");
        expect(destination, assertionLabel).toMatch(
          new RegExp(
            `^NEXT_REDIRECT;(?:push|replace);/giris\\?hata=${failurePath.errorCode};30[378];$`,
          ),
        );
        expect(destination, assertionLabel).not.toContain("callbackUrl");
        expect(destination, assertionLabel).not.toContain("evil.example");
        expect(logs, assertionLabel).not.toContain("evil.example");

        if (failurePath.expectsFailureLog) {
          expect(logs, assertionLabel).toContain("[koala-api]");
          expect(logs, assertionLabel).toContain("path=/admin/auth/login");
        } else {
          expect(logs, assertionLabel).toBe("");
        }
      }
    }

    expect(validationBackendCalls).toBe(0);
  });

  it("preserves canonical same-origin paths together with their query and hash", async () => {
    server.use(http.post(LOGIN, () => HttpResponse.json(loginEnvelope())));

    const safeCallbacks = [
      "/",
      "/audit-log?permission=payout.release#entry-42",
      "/disputes?durum=OPEN&uyusmazlik=d1000000-0000-4c00-8000-000000000001#kanitlar",
      "/audit-log?actor=owner%40iskoala.com&note=guvenli%20deger#ayrinti",
      "/companies?name=İş%20Ortağı#özeti",
      "/companies?name=%C4%B0%C5%9F%20Orta%C4%9F%C4%B1#%C3%B6zeti",
    ] as const;

    for (const safe of safeCallbacks) {
      const destination = await destinationOf(
        signInWithPassword(safe, form({ email: "o@iskoala.com", password: "gizli" })),
      );

      expect(destination, safe).toContain(`;${safe};307;`);
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

describe("the freshness line, drawn in one place", () => {
  /**
   * Çıkış ve parola değiştirme `getKoalaAccessToken()`'ı kullanamıyor (bkz.
   * `usableAccessToken`), yani "bu token hâlâ taze mi" sorusunu ikinci kez
   * soran bir yer var. Sorunun **cevabı** ikinci kez yazılırsa payı değiştiren
   * kişi burayı unutur ve hiçbir şey bunu söylemez: iki eşik de bugün 60 saniye
   * olduğu için davranış aynıdır, ta ki biri değişene kadar.
   *
   * Bu yüzden beklenti sabit bir sayıdan değil, ihraç edilen yardımcının
   * kendisinden türetiliyor. Payı `session.ts`'te değiştirmek bu testi hâlâ
   * yeşil bırakır; payı orada değiştirip burada değiştirmemek bırakmaz.
   */
  it("spends a refresh exactly when the shared helper calls the token stale", async () => {
    const now = Date.now();

    for (const offset of [-60_000, -1, 0, 30_000, 59_000, 5 * 60_000, 15 * 60_000]) {
      jar.clear();
      written = [];
      server.resetHandlers();

      const account = session({ accessExpiresAt: now + offset });
      jar.set(SESSION_COOKIE_NAME, encodeStaffSession(account));

      let refreshes = 0;
      server.use(
        http.post(REFRESH, () => {
          refreshes += 1;
          return HttpResponse.json({
            success: true,
            message: "Token yenilendi.",
            httpStatus: "200 OK",
            path: "/admin/auth/refresh",
            requestId: "rid-refresh",
            timeStamp: "2026-09-08T09:00:00.000000000Z",
            data: {
              accessToken: "fresh-access-token",
              refreshToken: "fresh-refresh-token",
              accessExpiresAt: new Date(now + 15 * 60 * 1000).toISOString(),
              refreshExpiresAt: new Date(now + 12 * HOUR).toISOString(),
              mustChangePassword: false,
            },
          });
        }),
      );
      server.use(
        http.post(LOGOUT, () =>
          HttpResponse.json({
            success: true,
            message: "Çıkış yapıldı.",
            httpStatus: "200 OK",
            path: "/admin/auth/logout",
            requestId: "rid-logout",
            timeStamp: "2026-09-08T09:00:00.000000000Z",
          }),
        ),
      );

      await destinationOf(signOut());

      expect(
        refreshes,
        `accessExpiresAt = now ${offset >= 0 ? "+" : "-"} ${Math.abs(offset)}`,
      ).toBe(isAccessTokenFresh(account, now) ? 0 : 1);
    }
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
