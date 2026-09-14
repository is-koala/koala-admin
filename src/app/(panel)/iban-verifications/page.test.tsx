import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody, searchQueryTooLongBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * IBAN kuyruğu sayfası. Kapı ve arama: `bank.account.verify` yoksa GET hiç
 * çıkmaz; `?ara=` backend'e `query` olarak gider ve sonuç satırı onu adıyla
 * söyler (koala-admin#94).
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: IbanVerificationsPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const PENDING_LIST = apiUrl("/admin/bank-account-verifications");
const VERIFIER = ["bank.account.verify"];
const ANALYST = ["finance.read"];

const REFERENCE = "KOALA-9F3A2C";

const PENDING_ROW = {
  accountId: "7c000000-0000-4000-8000-000000000048",
  user: {
    id: "b2000000-0000-4000-8000-000000000002",
    firstName: "Ayşe",
    lastName: "Yılmaz",
    username: "ayse",
  },
  maskedIban: "TR18***2315",
  reference: REFERENCE,
  amount: "0.17",
  startedAt: "2026-09-11T12:00:00Z",
  expiresAt: "2026-09-12T12:00:00Z",
  createdAt: "2026-09-11T11:00:00Z",
};

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["FINANCE_OFFICER"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watchQueue(rows: unknown[] = [], respond?: () => Response) {
  const seen: { calls: number; url: URL | null } = { calls: 0, url: null };
  server.use(
    http.get(PENDING_LIST, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      if (respond !== undefined) return respond();
      return HttpResponse.json({
        success: true,
        message: "Bekleyen doğrulamalar listelendi.",
        httpStatus: "200 OK",
        path: "/admin/bank-account-verifications",
        requestId: "rid-iban-list",
        timeStamp: "2026-09-12T00:00:00.000000000Z",
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
  );
  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (
    await renderServerComponent(<IbanVerificationsPage searchParams={Promise.resolve(params)} />)
  ).replaceAll("<!-- -->", "");

describe("who can see the IBAN queue", () => {
  it("refuses a finance.read holder and never asks the backend", async () => {
    stubMe(ANALYST, ["FINANCE_ANALYST"]);
    const queue = watchQueue([PENDING_ROW]);

    const html = await render();

    expect(queue.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).not.toContain(REFERENCE);
  });

  it("lists the pending queue for bank.account.verify", async () => {
    stubMe(VERIFIER);
    const queue = watchQueue([PENDING_ROW]);

    const html = await render();

    expect(queue.calls).toBe(1);
    expect(queue.url?.searchParams.get("status")).toBe("PENDING");
    expect(queue.url?.searchParams.has("query")).toBe(false);
    expect(html).toContain(REFERENCE);
    expect(html).toContain("Ayşe Yılmaz");
  });
});

describe("the search box — koala-admin#94", () => {
  it("sends ara to the backend as query, still PENDING-only, and names it in the result line", async () => {
    stubMe(VERIFIER);
    const queue = watchQueue([PENDING_ROW]);

    const html = await render({ ara: " 9F3A " });

    expect(queue.url?.searchParams.get("query")).toBe("9F3A");
    expect(queue.url?.searchParams.get("status")).toBe("PENDING");
    expect(html).toContain("“9F3A” için 1 doğrulama bulundu.");
    expect(html).toContain('name="ara"');
  });

  it("offers Temizle, which drops ara and keeps the selected reference", async () => {
    stubMe(VERIFIER);
    watchQueue([PENDING_ROW]);

    const html = await render({ ara: "9F3A", referans: REFERENCE });

    expect(html).toContain(`href="/iban-verifications?boyut=20&amp;referans=${REFERENCE}"`);
    expect(html).toContain("Temizle");
  });

  it("keeps the search on the row's Onayla link", async () => {
    stubMe(VERIFIER);
    watchQueue([PENDING_ROW]);

    const html = await render({ ara: "9F3A" });

    expect(html).toContain(`/iban-verifications?referans=${REFERENCE}&amp;tutar=0.17&amp;ara=9F3A`);
  });

  it("says there is no result for the query", async () => {
    stubMe(VERIFIER);
    watchQueue([]);

    const html = await render({ ara: "kimse" });

    expect(html).toContain("“kimse” için sonuç yok.");
    expect(html).not.toContain("Bekleyen IBAN doğrulaması yok.");
  });

  it("shows the backend's 400 for an over-long query inline", async () => {
    stubMe(VERIFIER);
    watchQueue([], () =>
      HttpResponse.json(searchQueryTooLongBody("/admin/bank-account-verifications"), {
        status: 400,
      }),
    );

    const html = await render({ ara: "k".repeat(120) });

    expect(html).toContain("Arama metni en fazla 100 karakter olabilir.");
    expect(html).not.toContain("Bekleyen IBAN doğrulamaları yüklenemedi.");
  });
});

/** koala-admin#100 / koala-backend#283: kuyruk satırında kalan deneme sütunu. */
describe("the attempts-left column", () => {
  it("draws the remaining attempts per row and the empty value for a #265 server", async () => {
    stubMe(VERIFIER);
    watchQueue([{ ...PENDING_ROW, attemptsLeft: 1 }]);
    const html = await render();
    expect(html).toContain("Kalan deneme");
    expect(html).toMatch(/<td[^>]*>1<\/td>/);

    stubMe(VERIFIER);
    watchQueue([PENDING_ROW]);
    const legacy = await render();
    expect(legacy).toContain("Kalan deneme");
    expect(legacy).toMatch(/<td[^>]*>—<\/td>/);
  });
});

/** koala-admin#108 / koala-backend#301: kullanıcı sayfasının banka sekmesi kuyruğu `?kullanici=` ile açar. */
describe("the user filter", () => {
  const USER_ID = PENDING_ROW.user.id;

  it("sends kullanici as userId, says so above the queue and keeps it on Onayla and clear", async () => {
    stubMe(VERIFIER);
    const queue = watchQueue([PENDING_ROW]);

    const html = await render({ kullanici: USER_ID, ara: "9F3A" });

    expect(queue.url?.searchParams.get("userId")).toBe(USER_ID);
    expect(queue.url?.searchParams.get("status")).toBe("PENDING");
    expect(html).toContain('data-testid="iban-user-filter"');
    expect(html).toContain(USER_ID);
    // "Süzgeci kaldır" kullanıcıyı düşürür, arama ve boyut kalır.
    expect(html).toContain('href="/iban-verifications?boyut=20&amp;ara=9F3A"');
    expect(html).toContain(
      `/iban-verifications?referans=${REFERENCE}&amp;tutar=0.17&amp;ara=9F3A&amp;kullanici=${USER_ID}`,
    );
  });

  it("drops a kullanici that is not a UUID instead of sending it", async () => {
    stubMe(VERIFIER);
    const queue = watchQueue([PENDING_ROW]);

    const html = await render({ kullanici: "javascript:alert(1)" });

    expect(queue.url?.searchParams.has("userId")).toBe(false);
    expect(html).not.toContain('data-testid="iban-user-filter"');
    expect(html).not.toContain("kullanici=");
  });
});
