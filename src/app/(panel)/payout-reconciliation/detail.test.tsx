import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_ID,
  PAYMENT_ID,
  PAYOUT_ID,
  adminPayoutDetailFixture,
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

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { default: PayoutDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const PAYOUT = apiUrl(`/admin/payouts/${PAYOUT_ID}`);

const OFFICER = ["payout.reconcile"];

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

function watch(payout: unknown = adminPayoutDetailFixture()) {
  const seen = { calls: 0, authorization: null as string | null };
  server.use(
    http.get(PAYOUT, ({ request }) => {
      seen.calls += 1;
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(envelope(`/admin/payouts/${PAYOUT_ID}`, payout));
    }),
  );
  return seen;
}

const render = async (id: string = PAYOUT_ID) =>
  (await renderServerComponent(<PayoutDetailPage params={Promise.resolve({ id })} />)).replaceAll(
    "<!-- -->",
    "",
  );

describe("who can open a payout", () => {
  it("refuses a payment.read holder and never asks the backend", async () => {
    stubMe(["payment.read"], ["FINANCE_ANALYST"]);
    const seen = watch();

    const html = await render();

    expect(seen.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Hakedişi banka ekstresiyle mutabık kıl");
    expect(html).not.toContain("iyz-transaction-000033");
  });

  it("renders the #80 evidence fields and the settlement history", async () => {
    stubMe(OFFICER);
    const seen = watch();

    const html = await render();

    expect(seen.calls).toBe(1);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).not.toContain("ACCESS-TOKEN");

    expect(html).toContain("İşleniyor");
    expect(html).toContain("₺1.240,50");
    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("ayse@example.com");
    expect(html).toContain("TR** **** **** **** **** **12 34");
    expect(html).toContain("iyz-transaction-000033");

    expect(html).toContain("Settlement geçmişi");
    expect(html).toContain("Onay");
    expect(html).toContain("İade");
    expect(html).toContain("Provider timeout");
    expect(html).toContain("iyz-tx-000071");
    expect(html).toContain(PAYMENT_ID);
  });

  it("prefills the reconcile form with payout id, provider reference, amount and currency", async () => {
    stubMe(OFFICER);
    watch();

    const html = await render();

    expect(html).toContain("Ekstre onayı");
    expect(html).toContain(`value="${PAYOUT_ID}"`);
    expect(html).toContain('value="iyz-transaction-000033"');
    expect(html).toContain('value="1240.50"');
    expect(html).toContain('value="TRY"');
  });

  it("does not draw the form for a payout that is not PROCESSING", async () => {
    stubMe(OFFICER);
    watch(
      adminPayoutDetailFixture({
        status: "COMPLETED",
        settlementReference: "TRF-2026-000033",
        completedAt: "2026-09-09T09:30:00Z",
      }),
    );

    const html = await render();

    expect(html).toContain("payout-not-reconcilable");
    expect(html).toContain("TRF-2026-000033");
    expect(html).not.toContain(`value="${PAYOUT_ID}"`);
  });

  it("links the assignment and payment only to a payment.read holder", async () => {
    stubMe(OFFICER);
    watch();
    const alone = await render();
    expect(alone).not.toContain(`href="/assignments/${ASSIGNMENT_ID}"`);
    expect(alone).not.toContain(`href="/payments/${PAYMENT_ID}"`);
    expect(alone).toContain(ASSIGNMENT_ID);

    stubMe(["payout.reconcile", "payment.read"]);
    watch();
    const both = await render();
    expect(both).toContain(`href="/assignments/${ASSIGNMENT_ID}"`);
    expect(both).toContain(`href="/payments/${PAYMENT_ID}"`);
  });

  /** koala-admin#99: `paymentId` hakedişin kendi alanıdır, deneme listesine bağlı değil. */
  it("links the payout's own paymentId even when the attempt list is empty", async () => {
    stubMe(OFFICER);
    watch(adminPayoutDetailFixture({ paymentAttempts: [] }));
    const alone = await render();
    expect(alone).toMatch(/Ödeme<\/dt><dd[^>]*><span[^>]*>7b000000-0000-4000-8000-000000000071</);
    expect(alone).not.toContain(`href="/payments/${PAYMENT_ID}"`);

    stubMe(["payout.reconcile", "payment.read"]);
    watch(adminPayoutDetailFixture({ paymentAttempts: [] }));
    const both = await render();
    expect(both).toContain(`href="/payments/${PAYMENT_ID}"`);
  });

  it("writes the empty value when the payout has no paymentId", async () => {
    stubMe(OFFICER);
    watch(adminPayoutDetailFixture({ paymentId: null, paymentAttempts: [] }));

    const html = await render();

    expect(html).toMatch(/Ödeme<\/dt><dd[^>]*>—</);
  });

  it("says when there is no settlement task", async () => {
    stubMe(OFFICER);
    watch(adminPayoutDetailFixture({ settlementTasks: [], paymentAttempts: [] }));

    const html = await render();

    expect(html).toContain("Settlement işi yok.");
    expect(html).toContain("Bu hakedişe bağlı ödeme denemesi yok.");
  });
});

/** koala-admin#85: olmayan hakediş ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("a payout that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(OFFICER);
    let calls = 0;
    server.use(
      http.get(PAYOUT, () => {
        calls += 1;
        return HttpResponse.json(
          {
            ...resourceNotFoundBody,
            errorCode: "PAYOUT_NOT_FOUND",
            path: `/admin/payouts/${PAYOUT_ID}`,
          },
          { status: 404 },
        );
      }),
    );

    const thrown = await renderServerComponent(
      <PayoutDetailPage params={Promise.resolve({ id: PAYOUT_ID })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an id that cannot be a UUID the same way, without asking the backend", async () => {
    stubMe(OFFICER);
    const seen = watch();

    const thrown = await renderServerComponent(
      <PayoutDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(seen.calls).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});

/** koala-admin#100 / koala-backend#283: serbest bırakma kaynağı, ekstre anı, mutabakatı onaylayan. */
describe("release origin, settlement instant and the reconciling staff member", () => {
  it("draws the three provenance fields and the bank account id when the DTO carries them", async () => {
    stubMe(OFFICER);
    watch(
      adminPayoutDetailFixture({
        status: "COMPLETED",
        releaseOrigin: "DISPUTE",
        settledAt: "2026-09-03T10:15:00Z",
        reconciledByStaffId: "5f000000-0000-4000-8000-000000000055",
        bankAccountId: "3b000000-0000-4000-8000-000000000031",
      }),
    );

    const html = await render();

    expect(html).toMatch(/Serbest bırakan<\/dt><dd[^>]*>Uyuşmazlık kararı</);
    expect(html).toMatch(/Ekstrede gerçekleşme<\/dt><dd[^>]*>03\.09\.2026 13:15</);
    expect(html).toContain("5f000000-0000-4000-8000-000000000055");
    expect(html).toContain("3b000000-0000-4000-8000-000000000031");
  });

  it("writes the empty value for a #265 server and for an un-backfilled origin", async () => {
    stubMe(OFFICER);
    watch();

    const html = await render();

    expect(html).toMatch(/Serbest bırakan<\/dt><dd[^>]*>—</);
    expect(html).toMatch(/Ekstrede gerçekleşme<\/dt><dd[^>]*>—</);
    expect(html).toMatch(/Mutabakatı onaylayan<\/dt><dd[^>]*>—</);
    expect(html).toMatch(/Banka hesabı<\/dt><dd[^>]*>—</);
  });
});
