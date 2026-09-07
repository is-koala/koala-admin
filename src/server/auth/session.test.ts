import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { encodeStaffSession, type StaffSession } from "./cookies";

/**
 * `getKoalaAccessToken()` — panelin backend'e giden **tek** token kaynağı.
 *
 * Buradaki testlerin hepsi bir reddi ölçüyor. Sebep şu: bu fonksiyon bir token
 * döndürdüğünde arkasındaki her `/admin/**` çağrısı yapılır, ve panelin izin
 * kümesi `payout.release`e kadar uzanıyor. "Token vermedi" bu yüzden "ekran
 * boş çizildi"den çok daha güçlü bir iddia.
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
        jar.set(name, value);
      },
    }),
}));

const { SESSION_COOKIE_NAME, getKoalaAccessToken, readStaffSession, isAccessTokenFresh } =
  await import("./session");
const { StaffAuthError } = await import("./errors");

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

function signIn(overrides: Partial<StaffSession> = {}): void {
  jar.set(SESSION_COOKIE_NAME, encodeStaffSession(session(overrides)));
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "no-throw";
  } catch (error) {
    return error instanceof StaffAuthError ? error.code : `other: ${String(error)}`;
  }
}

beforeEach(() => {
  jar.clear();
  written = [];
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("without a session cookie", () => {
  it("hands out no token at all", async () => {
    expect(await codeOf(getKoalaAccessToken())).toBe("SESSION_REQUIRED");
    expect(await readStaffSession()).toBeNull();
  });

  it("hands out no token for a cookie that does not decode either", async () => {
    jar.set(SESSION_COOKIE_NAME, "bu-bir-oturum-degil");

    expect(await codeOf(getKoalaAccessToken())).toBe("SESSION_REQUIRED");
  });
});

describe("with a live session", () => {
  it("hands out the access token without touching the backend", async () => {
    signIn();
    let refreshes = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return HttpResponse.error();
      }),
    );

    expect(await getKoalaAccessToken()).toBe("access-token");
    expect(refreshes).toBe(0);
  });

  it("treats a token inside the skew window as already stale", async () => {
    // Bir çağrının başında alınan token, çağrı bitmeden ölmemeli.
    expect(isAccessTokenFresh(session({ accessExpiresAt: Date.now() + 30_000 }))).toBe(false);
    expect(isAccessTokenFresh(session({ accessExpiresAt: Date.now() + 5 * 60_000 }))).toBe(true);
  });
});

describe("an expired or rejected token", () => {
  it("is refused when the backend rejects the refresh", async () => {
    signIn({ accessExpiresAt: Date.now() - 1000 });
    server.use(
      http.post(REFRESH, () =>
        HttpResponse.json(
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
        ),
      ),
    );

    expect(await codeOf(getKoalaAccessToken())).toBe("SESSION_EXPIRED");
  });

  it("is refused without a round trip once the refresh token is past its life", async () => {
    signIn({ accessExpiresAt: Date.now() - HOUR, refreshExpiresAt: Date.now() - 1000 });
    let refreshes = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return HttpResponse.error();
      }),
    );

    expect(await codeOf(getKoalaAccessToken())).toBe("SESSION_EXPIRED");
    expect(refreshes).toBe(0);
  });

  it("says the backend is down rather than blaming the person, when it is", async () => {
    // Fark, kişiye ne söyleneceğini belirliyor: "yeniden giriş yapın" mı,
    // "sizinle ilgili değil, bekleyin" mi.
    signIn({ accessExpiresAt: Date.now() - 1000 });
    server.use(http.post(REFRESH, () => HttpResponse.error()));

    expect(await codeOf(getKoalaAccessToken())).toBe("BACKEND_UNREACHABLE");
  });

  it("renews and writes the rotated cookie back, HttpOnly", async () => {
    signIn({ accessExpiresAt: Date.now() - 1000 });
    server.use(
      http.post(REFRESH, () =>
        HttpResponse.json({
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
          },
        }),
      ),
    );

    expect(await getKoalaAccessToken()).toBe("fresh-access-token");
    expect(written.at(-1)?.options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
  });
});

describe("an account that has to change its password first", () => {
  it("gets no token, and gets the reason that has a screen behind it", async () => {
    // Token verilseydi backend her ucu 403'le reddederdi ve panel bunu
    // "personel kaydınız yok" diye yanlış okurdu — yani kişi, düzeltebileceği
    // bir engeli düzeltemeyeceği bir engel sanırdı.
    signIn({ mustChangePassword: true });
    let refreshes = 0;
    server.use(
      http.post(REFRESH, () => {
        refreshes += 1;
        return HttpResponse.error();
      }),
    );

    expect(await codeOf(getKoalaAccessToken())).toBe("PASSWORD_CHANGE_REQUIRED");
    expect(refreshes).toBe(0);
  });
});
