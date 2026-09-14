import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_ID,
  JOB_ID,
  PAYMENT_ID,
  adminPaymentFixture,
  envelope,
} from "../../../../test/fixtures/admin-detail";
import { adminMeSuccessBody, resourceNotFoundBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { renderServerComponent } from "../../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const backendSaysPasswordMustChange = vi.fn<() => Promise<boolean | null>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => backendSaysPasswordMustChange(),
}));

const { default: PaymentDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const PAYMENT = apiUrl(`/admin/payments/${PAYMENT_ID}`);

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

function stubMe(permissions: readonly string[], roles: readonly string[] = ["FINANCE_ANALYST"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function watch(payment: unknown = adminPaymentFixture()) {
  const seen = { calls: 0, authorization: null as string | null };
  server.use(
    http.get(PAYMENT, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(envelope(`/admin/payments/${PAYMENT_ID}`, payment));
    }),
  );
  return seen;
}

const render = async (id: string = PAYMENT_ID) =>
  (await renderServerComponent(<PaymentDetailPage params={Promise.resolve({ id })} />)).replaceAll(
    "<!-- -->",
    "",
  );

describe("who can open a payment attempt", () => {
  it("refuses a finance.read holder and never asks the backend", async () => {
    stubMe(["finance.read"]);
    const seen = watch();

    const html = await render();

    expect(seen.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Ödemeleri görüntüle");
    expect(html).not.toContain("iyz-pay-000071");
  });

  it("renders the attempt, its breakdown, provider references and refunds", async () => {
    stubMe(ANALYST);
    const seen = watch();

    const html = await render();

    expect(seen.calls).toBe(1);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).not.toContain("ACCESS-TOKEN");

    expect(html).toContain("Başarılı");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("₺1.240,50");
    expect(html).toContain("₺137,83");
    expect(html).toContain("%10");
    expect(html).toContain("conv-000071");
    expect(html).toContain("iyz-pay-000071");
    expect(html).toContain("iyz-tx-000071");
    expect(html).toContain(`href="/assignments/${ASSIGNMENT_ID}"`);

    expect(html).toContain("İade kayıtları");
    expect(html).toContain("iyz-refund-000081");
    expect(html).toContain("İşveren talebi");
    expect(html).toContain("Tamamlandı");
  });

  it("never renders card data even when the payload carries stray fields", async () => {
    stubMe(ANALYST);
    watch({ ...adminPaymentFixture(), cardNumber: "4111111111111111", paymentToken: "tok_secret" });

    const html = await render();

    expect(html).not.toContain("4111111111111111");
    expect(html).not.toContain("tok_secret");
  });

  it("links the job only to a job.read holder", async () => {
    stubMe(ANALYST);
    watch();
    expect(await render()).not.toContain(`href="/jobs/${JOB_ID}"`);

    stubMe(["payment.read", "job.read"]);
    watch();
    expect(await render()).toContain(`href="/jobs/${JOB_ID}"`);
  });

  it("says when there are no refunds", async () => {
    stubMe(ANALYST);
    watch(adminPaymentFixture({ refunds: [] }));

    const html = await render();

    expect(html).toContain("Bu deneme için iade kaydı yok.");
  });
});

/** koala-admin#99: zod'da olup çizilmeyen alanlar ve denetim izi bağlantısı. */
describe("the pricing snapshot, refund updates and the audit pointer", () => {
  it("draws the pricing breakdown next to the realised amounts", async () => {
    stubMe(ANALYST);
    watch(
      adminPaymentFixture({
        pricing: {
          pricingVersion: "v2",
          currency: "TRY",
          workerPayout: "1000.00",
          serviceFeeRate: "0.1250",
          serviceFeeAmount: "125.00",
          employerTotal: "1125.00",
        },
      }),
    );

    const html = await render();

    expect(html).toContain('data-testid="payment-pricing"');
    expect(html).toMatch(/Komisyon oranı<\/dt><dd[^>]*>%12,5</);
    expect(html).toMatch(/İşverenden tahsil edilecek<\/dt><dd[^>]*>₺1\.125,00</);
    expect(html).toMatch(/İşçiye ödenecek<\/dt><dd[^>]*>₺1\.000,00</);
    expect(html).toMatch(/Komisyon tutarı<\/dt><dd[^>]*>₺125,00</);
  });

  it("says when the payment carries no pricing snapshot", async () => {
    stubMe(ANALYST);
    watch(adminPaymentFixture({ pricing: null }));

    const html = await render();

    expect(html).toContain("payment-pricing-missing");
    expect(html).toContain("Bu deneme için fiyat dökümü yok.");
  });

  it("shows each refund's last update next to its completion", async () => {
    stubMe(ANALYST);
    const [refund] = adminPaymentFixture().refunds as Record<string, unknown>[];
    watch(
      adminPaymentFixture({
        refunds: [{ ...refund, updatedAt: "2026-09-03T09:12:00.000000000Z" }],
      }),
    );

    const html = await render();

    expect(html).toMatch(/<th[^>]*>Tamamlanma<\/th><th[^>]*>Güncelleme<\/th>/);
    expect(html).toContain("03.09.2026 12:00");
    expect(html).toContain("03.09.2026 12:12");
  });

  it("points at the audit log filtered to this payment, only for an audit.read holder", async () => {
    stubMe(ANALYST);
    watch();
    const alone = await render();
    expect(alone).not.toContain("Her değişiklik denetim kaydında");
    expect(alone).not.toContain("/audit-log?");

    stubMe([...ANALYST, "audit.read"]);
    watch();
    const html = await render();
    expect(html).toContain("Her değişiklik denetim kaydında");
    expect(html).toContain(`href="/audit-log?resourceId=${PAYMENT_ID}"`);
  });
});

/** koala-admin#85: olmayan ödeme ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("a payment that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(ANALYST);
    let calls = 0;
    server.use(
      http.get(PAYMENT, () => {
        calls += 1;
        return HttpResponse.json(
          {
            ...resourceNotFoundBody,
            errorCode: "PAYMENT_NOT_FOUND",
            path: `/admin/payments/${PAYMENT_ID}`,
          },
          { status: 404 },
        );
      }),
    );

    const thrown = await renderServerComponent(
      <PaymentDetailPage params={Promise.resolve({ id: PAYMENT_ID })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(ANALYST);
    const seen = watch();

    const thrown = await renderServerComponent(
      <PaymentDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(seen.calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
