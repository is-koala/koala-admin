import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_ID,
  DISPUTE_ID,
  JOB_ID,
  PAYMENT_ID,
  PAYOUT_ID,
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

/**
 * koala-admin#100 / koala-backend#283: hakediş bağlantısı ve iadenin kaynağı.
 * Eski sunucu ikisini de göndermez; hücreler "—".
 */
describe("the payout link and the refund origin", () => {
  function withOrigin(origin: string | null, originId: string | null) {
    const payment = adminPaymentFixture({ payoutId: PAYOUT_ID });
    const refunds = payment.refunds as Array<Record<string, unknown>>;
    return { ...payment, refunds: [{ ...refunds[0], origin, originId }] };
  }

  it("links the payout only to a payout.reconcile holder and keeps the id visible either way", async () => {
    stubMe(ANALYST);
    watch(withOrigin("STAFF", null));
    const alone = await render();
    expect(alone).toContain(PAYOUT_ID);
    expect(alone).not.toContain(`href="/payout-reconciliation/${PAYOUT_ID}"`);

    stubMe([...ANALYST, "payout.reconcile"]);
    watch(withOrigin("STAFF", null));
    const html = await render();
    expect(html).toContain(`href="/payout-reconciliation/${PAYOUT_ID}"`);
  });

  it("names the refund origin and links a dispute origin only to a dispute.resolve holder", async () => {
    stubMe(ANALYST);
    watch(withOrigin("DISPUTE", DISPUTE_ID));
    const alone = await render();
    expect(alone).toContain("Kaynak");
    expect(alone).toContain("Uyuşmazlık");
    expect(alone).toContain(DISPUTE_ID);
    expect(alone).not.toContain(`href="/disputes/${DISPUTE_ID}"`);

    stubMe([...ANALYST, "dispute.resolve"]);
    watch(withOrigin("DISPUTE", DISPUTE_ID));
    const html = await render();
    expect(html).toContain(`href="/disputes/${DISPUTE_ID}"`);
  });

  it("writes a cancellation origin's id as text and a staff origin without an id", async () => {
    stubMe([...ANALYST, "dispute.resolve"]);
    const cancellationId = "ca000000-0000-4000-8000-000000000001";
    watch(withOrigin("CANCELLATION", cancellationId));
    const cancelled = await render();
    expect(cancelled).toContain("İptal");
    expect(cancelled).toContain(cancellationId);
    expect(cancelled).not.toContain(`href="/disputes/${cancellationId}"`);

    stubMe(ANALYST);
    watch(withOrigin("STAFF", null));
    const staff = await render();
    expect(staff).toContain("Personel");
  });

  it("writes the empty value for a #265 server that sends neither payoutId nor origin", async () => {
    stubMe([...ANALYST, "payout.reconcile", "dispute.resolve"]);
    watch();
    const html = await render();
    expect(html).toMatch(/Hakediş<\/dt><dd[^>]*>—</);
    expect(html).not.toContain("/payout-reconciliation/");
    expect(html).not.toContain("/disputes/");
  });
});

/** koala-admin#112: ödemenin listesi yok; kırıntı atamayı `?atama=` ile tanır. */
describe("the payment page's breadcrumb", () => {
  it("writes Atama özeti › payment when the address carries no assignment", async () => {
    stubMe(ANALYST);
    watch();

    const html = await render();

    expect(html).toContain('<nav aria-label="Konum">');
    expect(html).toContain('href="/assignments"><span>Atama özeti</span></a>');
    expect(html).toContain(`title="${PAYMENT_ID}">${PAYMENT_ID.slice(0, 8)}<`);
    expect(html).not.toContain(`title="${ASSIGNMENT_ID}">${ASSIGNMENT_ID.slice(0, 8)}</span></a>`);
  });

  it("inserts the assignment as a linked middle crumb when ?atama= is a UUID", async () => {
    stubMe(ANALYST);
    watch();

    const html = (
      await renderServerComponent(
        <PaymentDetailPage
          params={Promise.resolve({ id: PAYMENT_ID })}
          searchParams={Promise.resolve({ atama: ASSIGNMENT_ID })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).toContain(
      `href="/assignments/${ASSIGNMENT_ID}"><span class="font-mono text-xs" title="${ASSIGNMENT_ID}">${ASSIGNMENT_ID.slice(0, 8)}</span></a>`,
    );
    expect(html).toContain(
      `aria-current="page" class="text-ink"><span class="font-mono text-xs" title="${PAYMENT_ID}">`,
    );
  });

  it("ignores an ?atama= that is not a UUID", async () => {
    stubMe(ANALYST);
    watch();

    const html = (
      await renderServerComponent(
        <PaymentDetailPage
          params={Promise.resolve({ id: PAYMENT_ID })}
          searchParams={Promise.resolve({ atama: "javascript:alert(1)" })}
        />,
      )
    ).replaceAll("<!-- -->", "");

    expect(html).not.toContain("javascript:");
    expect(html).toContain('href="/assignments"><span>Atama özeti</span></a>');
  });
});
