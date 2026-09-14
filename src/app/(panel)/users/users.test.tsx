import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody, resourceNotFoundBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { default: UsersPage } = await import("./page");
const { default: UserDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const USERS = apiUrl("/admin/users");

const READER = ["user.read"];
const MODERATOR = ["content.moderate"];

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  backendSaysPasswordMustChange.mockResolvedValue(false);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  backendSaysPasswordMustChange.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["SUPPORT_AGENT"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

interface UserRow {
  id: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  profilePictureUrl: string | null;
  email?: string;
}

function row(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    firstName: "Ada",
    lastName: "Yılmaz",
    username: "ada",
    profilePictureUrl: null,
    ...overrides,
  };
}

function watchQueue(rows: UserRow[]) {
  const seen: {
    calls: number;
    roleCalls: number;
    url: URL | null;
    authorization: string | null;
  } = {
    calls: 0,
    roleCalls: 0,
    url: null,
    authorization: null,
  };

  server.use(
    http.get(USERS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json({
        success: true,
        message: "Kullanıcılar listelendi.",
        httpStatus: "200 OK",
        path: "/admin/users",
        requestId: "rid-users",
        timeStamp: "2026-09-11T13:00:00.000000000Z",
        data: {
          content: rows,
          page: 0,
          size: 20,
          totalElements: rows.length,
          totalPages: rows.length === 0 ? 0 : 1,
          first: true,
          last: true,
        },
      });
    }),
    http.get(apiUrl("/admin/users/:userId/roles"), ({ request }) => {
      seen.roleCalls += 1;
      const userId = new URL(request.url).pathname.split("/")[3] ?? "";
      return HttpResponse.json({
        success: true,
        message: "Roller listelendi.",
        httpStatus: "200 OK",
        path: `/admin/users/${userId}/roles`,
        requestId: "rid-user-roles",
        timeStamp: "2026-09-11T13:00:00.000000000Z",
        data: [
          {
            role: "ROLE_USER",
            grantedAt: "2026-01-01T08:00:00.000000000Z",
            grantedById: "00000000-0000-0000-0000-000000000001",
            grantedByName: "Sistem",
          },
        ],
      });
    }),
  );

  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (await renderServerComponent(<UsersPage searchParams={Promise.resolve(params)} />)).replaceAll(
    "<!-- -->",
    "",
  );

describe("who can see the directory", () => {
  it("refuses a MODERATOR and never asks the backend for users", async () => {
    stubMe(MODERATOR, ["MODERATOR"]);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(queue.roleCalls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Kullanıcıları görüntüle");
    expect(html).not.toContain("Ada Yılmaz");
  });

  it("lets user.read through and keeps the bearer token on the server", async () => {
    stubMe(READER);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(queue.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).toContain("Ada Yılmaz");
    expect(html).toContain("ada");
    expect(html).toContain("aaaaaaaa-1111-4111-8111-111111111111");
    expect(html).not.toContain("ACCESS-TOKEN");
  });
});

describe("search and paging are backend query parameters", () => {
  it("omits query when the search box is empty", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    await render();

    expect(queue.url?.searchParams.has("query")).toBe(false);
    expect(queue.url?.searchParams.get("page")).toBe("0");
    expect(queue.url?.searchParams.get("size")).toBe("20");
    expect(queue.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });

  it("sends a trimmed name or email search with the requested page and sort", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    const html = await render({
      ara: "  ada@example.com  ",
      sayfa: "1",
      boyut: "40",
      sirala: "firstName,asc",
    });

    expect(queue.url?.searchParams.get("query")).toBe("ada@example.com");
    expect(queue.url?.searchParams.get("page")).toBe("1");
    expect(queue.url?.searchParams.get("size")).toBe("40");
    expect(queue.url?.searchParams.get("sort")).toBe("firstName,asc");
    expect(html).toContain("Ad ya da e-posta ara");
    expect(html).toContain('type="search"');
  });

  it("falls back to createdAt,desc for a sort Spring would reject", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    await render({ sirala: "email,asc" });

    expect(queue.url?.searchParams.get("sort")).toBe("createdAt,desc");
  });
});

describe("the safe user projection", () => {
  it("does not render an email even if the payload carries one", async () => {
    stubMe(READER);
    watchQueue([row({ email: "private@koala.test" })]);

    const html = await render();

    expect(html).toContain("Ada Yılmaz");
    expect(html).not.toContain("private@koala.test");
  });

  it("distinguishes an empty search result from a load failure", async () => {
    stubMe(READER);
    watchQueue([]);

    const html = await render({ ara: "yok" });

    expect(html).toContain("Aramayla eşleşen kullanıcı yok.");
    expect(html).not.toContain("Kullanıcı dizini yüklenemedi.");
  });

  it("renders the backend's 403 rather than an empty directory", async () => {
    stubMe(READER);
    const seen: { calls: number } = { calls: 0 };

    server.use(
      http.get(USERS, () => {
        seen.calls += 1;
        return HttpResponse.json(
          {
            success: false,
            message: "Bu işlem için yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-403",
            path: "/admin/users",
            timeStamp: "2026-09-11T13:00:00.000000000Z",
          },
          { status: 403 },
        );
      }),
    );

    const html = await render();

    expect(seen.calls).toBe(1);
    expect(html).toContain("Backend bu işlem için yetki vermedi.");
    expect(html).toContain("rid-403");
  });
});

describe("marketplace roles sit on the directory", () => {
  it("lets user.read list grants and does not draw write forms", async () => {
    stubMe(READER);
    const queue = watchQueue([row()]);

    const html = await render();

    expect(queue.roleCalls).toBe(1);
    expect(html).toContain("ROLE_USER");
    expect(html).toContain("Yalnız okuma");
    expect(html).not.toContain("Rol ver");
    expect(html).not.toContain("Rolü geri al");
  });

  it("keeps grant and revoke off the directory even when user.role.manage is held", async () => {
    stubMe(["user.read", "user.role.manage"]);
    watchQueue([row()]);

    const html = await render();

    expect(html).toContain("ROLE_USER");
    expect(html).not.toContain("Rol ver");
    expect(html).not.toContain("Rolü geri al");
    expect(html).not.toContain("Yalnız okuma");
  });

  it("does not ask for roles when the directory itself is empty", async () => {
    stubMe(READER);
    const queue = watchQueue([]);

    await render();

    expect(queue.calls).toBe(1);
    expect(queue.roleCalls).toBe(0);
  });
});

describe("a bookmarked marketplace user", () => {
  function stubUser(user: UserRow) {
    let objectCalls = 0;
    let reportCalls = 0;
    server.use(
      http.get(`${USERS}/${user.id}`, () => {
        objectCalls += 1;
        return HttpResponse.json({
          success: true,
          message: "Kullanıcı getirildi.",
          httpStatus: "200 OK",
          path: `/admin/users/${user.id}`,
          requestId: "rid-user",
          timeStamp: "2026-09-11T13:00:00.000000000Z",
          data: user,
        });
      }),
      http.get(apiUrl("/admin/users/:userId/roles"), () =>
        HttpResponse.json({
          success: true,
          message: "Roller listelendi.",
          httpStatus: "200 OK",
          path: `/admin/users/${user.id}/roles`,
          requestId: "rid-user-roles",
          timeStamp: "2026-09-11T13:00:00.000000000Z",
          data: [
            {
              role: "ROLE_USER",
              grantedAt: "2026-01-01T08:00:00.000000000Z",
              grantedById: "00000000-0000-0000-0000-000000000001",
              grantedByName: "Sistem",
            },
          ],
        }),
      ),
      http.get(apiUrl("/admin/reports"), () => {
        reportCalls += 1;
        return HttpResponse.json({
          success: true,
          message: "Şikayetler listelendi.",
          httpStatus: "200 OK",
          path: "/admin/reports",
          requestId: "rid-reports",
          timeStamp: "2026-09-11T13:00:00.000000000Z",
          data: {
            content: [],
            page: 0,
            size: 20,
            totalElements: 0,
            totalPages: 0,
            first: true,
            last: true,
          },
        });
      }),
    );
    return {
      get objectCalls() {
        return objectCalls;
      },
      get reportCalls() {
        return reportCalls;
      },
    };
  }

  it("loads GET /admin/users/{id} without a suspend control or a reports fetch", async () => {
    stubMe(READER);
    const user = row();
    const seen = stubUser(user);

    const html = (
      await renderServerComponent(<UserDetailPage params={Promise.resolve({ id: user.id })} />)
    ).replaceAll("<!-- -->", "");

    expect(seen.objectCalls).toBe(1);
    expect(seen.reportCalls).toBe(0);
    expect(html).toContain("Ada Yılmaz");
    expect(html).not.toContain(`kullanici=${user.id}`);
    expect(html).not.toMatch(/>Askıya al</);
    expect(html).not.toContain("suspend");
  });

  /** koala-admin#103: roller "Rol / Denetim" sekmesinde; varsayılan sekme rol isteği çıkarmaz. */
  it("lists the marketplace roles on the denetim tab", async () => {
    stubMe(READER);
    const user = row();
    stubUser(user);

    const html = (
      await renderServerComponent(
        <UserDetailPage
          params={Promise.resolve({ id: user.id })}
          searchParams={Promise.resolve({ sekme: "denetim" })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).toContain("ROLE_USER");
    expect(html).toContain("Sistem");
    expect(html).not.toContain("Rol ver");
  });

  it("draws grant and revoke on the denetim tab when user.role.manage is held", async () => {
    stubMe(["user.read", "user.role.manage"]);
    stubUser(row());

    const html = (
      await renderServerComponent(
        <UserDetailPage
          params={Promise.resolve({ id: row().id })}
          searchParams={Promise.resolve({ sekme: "denetim" })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).toContain("Rol ver");
    expect(html).toContain("Rolü geri al");
    expect(html).toContain("ROLE_ADMIN");
  });

  /** koala-admin#99: `profilePictureUrl` zod'da vardı, çizilmiyordu. */
  it("draws the profile picture from the DTO and the empty value without one", async () => {
    stubMe(READER);
    const user = row({ profilePictureUrl: "https://storage.koala.test/users/ada.jpg" });
    stubUser(user);

    const withPicture = (
      await renderServerComponent(<UserDetailPage params={Promise.resolve({ id: user.id })} />)
    ).replaceAll("<!-- -->", "");

    expect(withPicture).toMatch(
      /<img src="https:\/\/storage\.koala\.test\/users\/ada\.jpg" alt="Ada Yılmaz profil fotoğrafı"/,
    );

    const bare = row();
    stubUser(bare);
    const withoutPicture = (
      await renderServerComponent(<UserDetailPage params={Promise.resolve({ id: bare.id })} />)
    ).replaceAll("<!-- -->", "");

    expect(withoutPicture).toMatch(/Profil fotoğrafı<\/dt><dd[^>]*>—</);
    expect(withoutPicture).not.toContain("<img");
  });

  it("draws no img for a profile picture address that is not http(s)", async () => {
    stubMe(READER);
    for (const url of ["javascript:alert(1)", "data:image/png;base64,AAAA", "s3://bucket/a.jpg"]) {
      const user = row({ profilePictureUrl: url });
      stubUser(user);

      const html = (
        await renderServerComponent(<UserDetailPage params={Promise.resolve({ id: user.id })} />)
      ).replaceAll("<!-- -->", "");

      expect(html).not.toContain("<img");
      expect(html).not.toContain(url);
      expect(html).toMatch(/Profil fotoğrafı<\/dt><dd[^>]*>—</);
    }
  });

  it("loads open reports only when content.moderate is held", async () => {
    stubMe(["user.read", "content.moderate"]);
    const user = row();
    const seen = stubUser(user);

    const html = (
      await renderServerComponent(<UserDetailPage params={Promise.resolve({ id: user.id })} />)
    ).replaceAll("<!-- -->", "");

    expect(seen.reportCalls).toBe(1);
    expect(html).toContain("Açık şikayetler");
    expect(html).toContain(`kullanici=${user.id}`);
  });
});

/** koala-admin#85: olmayan kullanıcı ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("a marketplace user that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(READER);
    const user = row();
    let calls = 0;
    server.use(
      http.get(`${USERS}/${user.id}`, () => {
        calls += 1;
        return HttpResponse.json(
          { ...resourceNotFoundBody, errorCode: "USER_NOT_FOUND", path: `/admin/users/${user.id}` },
          { status: 404 },
        );
      }),
    );

    const thrown = await renderServerComponent(
      <UserDetailPage params={Promise.resolve({ id: user.id })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(READER);
    let calls = 0;
    server.use(
      http.get(`${USERS}/:userId`, () => {
        calls += 1;
        return HttpResponse.json(resourceNotFoundBody, { status: 404 });
      }),
    );

    const thrown = await renderServerComponent(
      <UserDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

/**
 * koala-admin#100 / koala-backend#283: `AdminUserDetailDto`. İletişim iki
 * kilitli (backend izinle doldurur, panel izinle çizer), sayaçlar süzgeçli
 * listelere yalnız o listenin izniyle bağlanır, eski sunucuda bölümler gizli.
 */
describe("the user detail's contact, verification, memberships, badges and history", () => {
  const DELETION_ID = "eeeeeeee-0000-4000-8000-00000000000e";
  const COMPANY_ID = "cccccccc-0000-4000-8000-00000000000c";

  function detail(overrides: Record<string, unknown> = {}) {
    return {
      ...row(),
      email: "ada@koala.test",
      phoneNumber: "+905551112233",
      emailVerified: true,
      phoneVerified: false,
      identityVerified: true,
      isEmployer: true,
      createdAt: "2026-01-05T10:00:00Z",
      companies: [{ id: COMPANY_ID, name: "Koala Kafe", role: "ADMIN" }],
      badges: [
        {
          code: "GEZGIN_BRONZE",
          family: "GEZGIN",
          tier: "BRONZE",
          name: "Gezgin",
          description: null,
          iconUrl: null,
          earnedAt: "2026-03-01T08:00:00Z",
        },
      ],
      counts: {
        applications: 3,
        assignmentsAsWorker: 2,
        assignmentsAsEmployer: 5,
        payments: 4,
        payouts: 1,
        disputes: 6,
        reportsReceived: 7,
        reportsMade: 8,
      },
      identityReviewStatus: "APPROVED",
      pendingDeletionRequestId: DELETION_ID,
      ...overrides,
    };
  }

  function stubDetail(data: unknown) {
    server.use(
      http.get(`${USERS}/${row().id}`, () =>
        HttpResponse.json({
          success: true,
          message: "Kullanıcı getirildi.",
          httpStatus: "200 OK",
          path: `/admin/users/${row().id}`,
          requestId: "rid-user",
          timeStamp: "2026-09-11T13:00:00.000000000Z",
          data,
        }),
      ),
      http.get(apiUrl("/admin/users/:userId/roles"), () =>
        HttpResponse.json({
          success: true,
          message: "Roller listelendi.",
          httpStatus: "200 OK",
          path: `/admin/users/${row().id}/roles`,
          requestId: "rid-user-roles",
          timeStamp: "2026-09-11T13:00:00.000000000Z",
          data: [],
        }),
      ),
    );
  }

  const renderDetail = async () =>
    (
      await renderServerComponent(<UserDetailPage params={Promise.resolve({ id: row().id })} />)
    ).replaceAll("<!-- -->", "");

  it("draws e-mail and phone only for a user.read_pii holder, even when the payload carries them", async () => {
    stubMe(READER);
    stubDetail(detail());
    const hidden = await renderDetail();
    expect(hidden).toContain('data-testid="user-contact-hidden"');
    expect(hidden).not.toContain("ada@koala.test");
    expect(hidden).not.toContain("+905551112233");

    stubMe(["user.read", "user.read_pii"]);
    stubDetail(detail());
    const shown = await renderDetail();
    expect(shown).toContain('data-testid="user-contact"');
    expect(shown).toContain("ada@koala.test");
    expect(shown).toContain("+905551112233");
    expect(shown).toContain("Doğrulandı");
    expect(shown).toContain("Doğrulanmadı");
  });

  it("draws the verification flags, identity review status, employer flag and deletion request", async () => {
    stubMe(READER);
    stubDetail(detail());
    const html = await renderDetail();

    expect(html).toMatch(/E-posta doğrulandı<\/dt><dd[^>]*>Evet</);
    expect(html).toMatch(/Telefon doğrulandı<\/dt><dd[^>]*>Hayır</);
    expect(html).toMatch(/Kimlik doğrulandı<\/dt><dd[^>]*>Evet</);
    expect(html).toMatch(/Kimlik incelemesi<\/dt><dd[^>]*>Onaylı</);
    expect(html).toMatch(/İşveren<\/dt><dd[^>]*>Evet</);
    expect(html).toContain("05.01.2026 13:00");
    // Silme talebi sayfası user.read_pii ister; izinsizde kimlik mono, bağlantı yok.
    expect(html).toContain(DELETION_ID);
    expect(html).not.toContain(`href="/account-deletions/${DELETION_ID}"`);

    stubMe(["user.read", "user.read_pii"]);
    stubDetail(detail());
    const pii = await renderDetail();
    expect(pii).toContain(`href="/account-deletions/${DELETION_ID}"`);
  });

  /** koala-admin#103: sayaç sayfadan çıkarmaz, ilgili sekmeyi açar; tam liste sekmede. */
  it("links each history counter to its tab only when that tab's permission is held", async () => {
    stubMe(READER);
    stubDetail(detail());
    const alone = await renderDetail();
    expect(alone).toContain('data-testid="user-history"');
    for (const count of ["3", "2", "5", "4", "1", "6", "7", "8"]) {
      expect(alone).toMatch(new RegExp(`<dd[^>]*>${count}</dd>`));
    }
    const id = row().id;
    expect(alone).not.toContain(`href="/users/${id}?sekme=atamalar"`);
    expect(alone).not.toContain(`href="/users/${id}?sekme=hakedisler"`);
    expect(alone).not.toContain(`href="/users/${id}?sekme=uyusmazliklar"`);
    expect(alone).not.toContain(`href="/users/${id}?sekme=sikayetler"`);

    stubMe([
      "user.read",
      "payment.read",
      "payout.reconcile",
      "dispute.resolve",
      "content.moderate",
    ]);
    stubDetail(detail());
    const linked = await renderDetail();
    expect(linked).toMatch(
      new RegExp(`Atamalar \\(işçi\\)</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=atamalar"`),
    );
    expect(linked).toMatch(
      new RegExp(`Atamalar \\(işveren\\)</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=atamalar"`),
    );
    expect(linked).toMatch(
      new RegExp(`Ödemeler</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=atamalar"`),
    );
    expect(linked).toMatch(
      new RegExp(`Hakedişler</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=hakedisler"`),
    );
    expect(linked).toMatch(
      new RegExp(`Uyuşmazlıklar</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=uyusmazliklar"`),
    );
    expect(linked).toMatch(
      new RegExp(
        `Hakkındaki şikayetler</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=sikayetler"`,
      ),
    );
    expect(linked).toMatch(
      new RegExp(`Açtığı şikayetler</dt><dd[^>]*><a[^>]*href="/users/${id}\\?sekme=sikayetler"`),
    );
    // Başvuruların listesi yok: sayı bağlantısız kalır.
    expect(linked).toMatch(/Başvurular<\/dt><dd[^>]*>3</);
  });

  it("lists memberships and badges, linking the company only to a company.approve holder", async () => {
    stubMe(READER);
    stubDetail(detail());
    const alone = await renderDetail();
    expect(alone).toContain("Koala Kafe");
    expect(alone).toContain("Yetkili");
    expect(alone).not.toContain(`href="/companies/${COMPANY_ID}"`);
    expect(alone).toContain("Gezgin");
    expect(alone).toContain("Bronz");
    expect(alone).toContain("01.03.2026 11:00");

    stubMe(["user.read", "company.approve"]);
    stubDetail(detail());
    const linked = await renderDetail();
    expect(linked).toContain(`href="/companies/${COMPANY_ID}"`);
  });

  it("says when the lists are empty and hides the sections a SafeUserDto server never sent", async () => {
    stubMe(READER);
    stubDetail(detail({ companies: [], badges: [], pendingDeletionRequestId: null }));
    const empty = await renderDetail();
    expect(empty).toContain("Bu kullanıcı hiçbir şirkette yetkili değil.");
    expect(empty).toContain("Bu kullanıcı henüz rozet kazanmamış.");
    expect(empty).toContain("Bekleyen talep yok");

    stubMe(["user.read", "user.read_pii"]);
    stubDetail(row());
    const legacy = await renderDetail();
    expect(legacy).toContain("Ada Yılmaz");
    expect(legacy).not.toContain('data-testid="user-history"');
    expect(legacy).not.toContain('data-testid="user-companies"');
    expect(legacy).not.toContain('data-testid="user-badges"');
    expect(legacy).toMatch(/E-posta doğrulandı<\/dt><dd[^>]*>—</);
    expect(legacy).toMatch(/Kimlik incelemesi<\/dt><dd[^>]*>—</);
    expect(legacy).toContain('data-testid="user-contact"');
    expect(legacy).toMatch(/E-posta<\/dt><dd[^>]*><span[^>]*><span[^>]*>—</);
  });
});
