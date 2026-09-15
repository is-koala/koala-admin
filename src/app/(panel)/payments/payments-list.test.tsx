import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_ID,
  PAYMENT_ID,
  adminPaymentFixture,
  pageEnvelope,
} from "../../../../test/fixtures/admin-detail";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

/**
 * Ödeme listesi (koala-admin#111): kapı, `?durum=`/`?sirala=` → backend
 * `status`/`sort`, satır ve takılı rozeti, boş ve düşen liste. Dolu / eksik
 * / izin üçlüsü; kart verisi hiçbir yerde yok.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: PaymentsPage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");
const PAYMENTS = apiUrl("/admin/payments");
const ANALYST = ["payment.read"];

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

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: {
          ...adminMeSuccessBody.data,
          roles: ["FINANCE_ANALYST"],
          permissions: [...permissions],
        },
      }),
    ),
  );
}

function watch(rows: unknown[] = [adminPaymentFixture()], respond?: () => Response) {
  const seen: { calls: number; url: URL | null; authorization: string | null } = {
    calls: 0,
    url: null,
    authorization: null,
  };
  server.use(
    http.get(PAYMENTS, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      if (respond !== undefined) return respond();
      return HttpResponse.json(pageEnvelope("/admin/payments", rows));
    }),
  );
  return seen;
}

const render = async (params: Record<string, string> = {}) =>
  (await renderServerComponent(<PaymentsPage searchParams={Promise.resolve(params)} />)).replaceAll(
    "<!-- -->",
    "",
  );

describe("who can open the payment list", () => {
  it("refuses a finance.read holder and never asks the backend", async () => {
    stubMe(["finance.read"]);
    const seen = watch();

    const html = await render();

    expect(seen.calls).toBe(0);
    expect(html).toContain("payment.read");
    expect(html).not.toContain("Garsonluk");
  });

  it("lists every status by default for payment.read and keeps the token on the server", async () => {
    stubMe(ANALYST);
    const seen = watch();

    const html = await render();

    expect(seen.calls).toBe(1);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(seen.url!.searchParams.has("status")).toBe(false);
    expect(seen.url!.searchParams.get("sort")).toBe("createdAt,desc");
    expect(seen.url!.searchParams.get("size")).toBe("20");
    expect(html).toContain("Toplam 1 ödeme denemesi.");
    expect(html).toContain("Garsonluk");
    expect(html).toContain("Koala Kafe");
    expect(html).toContain("Başarılı");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain(`href="/assignments/${ASSIGNMENT_ID}"`);
    expect(html).toContain(
      `href="/payments/${PAYMENT_ID}?durum=hepsi&amp;sirala=createdAt%2Cdesc&amp;boyut=20&amp;sayfa=0"`,
    );
    expect(html).not.toContain("ACCESS-TOKEN");
    expect(html).not.toContain("<code");
  });
});

describe("status and sort are backend query parameters", () => {
  it("sends durum as status and sirala as sort, and marks the stuck attempt", async () => {
    stubMe(ANALYST);
    const seen = watch([
      adminPaymentFixture({
        id: "7b000000-0000-4000-8000-000000000072",
        status: "VERIFY_PENDING",
        nextVerificationAt: null,
        verificationAttempts: 5,
        completedAt: null,
      }),
      adminPaymentFixture({
        id: "7b000000-0000-4000-8000-000000000073",
        status: "VERIFY_PENDING",
        nextVerificationAt: "2026-09-14T10:00:00.000000000Z",
        verificationAttempts: 1,
        completedAt: null,
      }),
    ]);

    const html = await render({ durum: "VERIFY_PENDING", sirala: "createdAt,asc" });

    expect(seen.url!.searchParams.get("status")).toBe("VERIFY_PENDING");
    expect(seen.url!.searchParams.get("sort")).toBe("createdAt,asc");
    expect(html).toContain("Takılı");
    expect(html).toContain("5 deneme");
    expect(html).toContain("Sonraki 14.09.2026 13:00");
    expect(html).toContain('<option value="VERIFY_PENDING" selected="">');
  });

  it("falls back to every status and the default sort for values Spring would reject", async () => {
    stubMe(ANALYST);
    const seen = watch();

    await render({ durum: "banana", sirala: "cardNumber,asc" });

    expect(seen.url!.searchParams.has("status")).toBe(false);
    expect(seen.url!.searchParams.get("sort")).toBe("createdAt,desc");
  });
});

describe("empty and failed lists", () => {
  it("tells an empty status filter apart from a load failure", async () => {
    stubMe(ANALYST);
    watch([]);
    const empty = await render({ durum: "FAILED" });
    expect(empty).toContain("Kayıt yok.");
    expect(empty).toContain("&quot;Başarısız&quot; durumunda ödeme denemesi yok.");
    expect(empty).not.toContain("yüklenemedi");

    watch([], () =>
      HttpResponse.json(
        {
          success: false,
          message: "Bu işlem için yetkiniz yok.",
          httpStatus: "403 FORBIDDEN",
          errorCode: "ACCESS_DENIED",
          errorCategory: "ACCESS_DENIED",
          requestId: "rid-403",
          path: "/admin/payments",
          timeStamp: "2026-09-11T13:00:00.000000000Z",
        },
        { status: 403 },
      ),
    );
    const failed = await render();
    expect(failed).toContain("Backend bu işlem için yetki vermedi.");
    expect(failed).toContain("ödeme listesi vermeyi reddetti");
    expect(failed).toContain("rid-403");
    expect(failed).not.toContain("Kayıt yok.");
  });
});
