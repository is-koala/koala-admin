import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  ASSIGNMENT_ID,
  DISPUTE_ID,
  JOB_ID,
  PAYMENT_ID,
  PAYOUT_ID,
  REPORT_ID,
  adminAssignmentDetailFixture,
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

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

const { default: AssignmentDetailPage } = await import("./[id]/page");

const ADMIN_ME = apiUrl("/admin/me");
const DETAIL = apiUrl(`/admin/job-assignments/${ASSIGNMENT_ID}`);
const PAYMENTS = apiUrl(`/admin/job-assignments/${ASSIGNMENT_ID}/payments`);

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

function watch(
  detail: unknown = adminAssignmentDetailFixture(),
  payments: unknown[] = [adminPaymentFixture()],
) {
  const seen = { detail: 0, payments: 0, authorization: null as string | null };
  server.use(
    http.get(DETAIL, ({ request }) => {
      seen.detail += 1;
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT_ID}`, detail));
    }),
    http.get(PAYMENTS, () => {
      seen.payments += 1;
      return HttpResponse.json(
        envelope(`/admin/job-assignments/${ASSIGNMENT_ID}/payments`, payments),
      );
    }),
  );
  return seen;
}

const render = async (id: string = ASSIGNMENT_ID) =>
  (
    await renderServerComponent(<AssignmentDetailPage params={Promise.resolve({ id })} />)
  ).replaceAll("<!-- -->", "");

describe("who can open an assignment", () => {
  it("refuses a dispute.resolve holder and never asks the backend", async () => {
    stubMe(["dispute.resolve"], ["DISPUTE_HANDLER"]);
    const seen = watch();

    const html = await render();

    expect(seen.detail).toBe(0);
    expect(seen.payments).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Ödemeleri görüntüle");
    expect(html).not.toContain("Ayşe Yılmaz");
  });

  it("renders summary, pricing, timeline, payment attempts, payout and linked records", async () => {
    stubMe(ANALYST);
    const seen = watch();

    const html = await render();

    expect(seen.detail).toBe(1);
    expect(seen.payments).toBe(1);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(html).not.toContain("ACCESS-TOKEN");

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Mehmet Demir");
    expect(html).toContain("Koala Kafe");
    expect(html).toContain("Garsonluk");
    expect(html).toContain("₺1.240,50");
    expect(html).toContain("₺1.378,33");
    expect(html).toContain("Emanette");

    expect(html).toContain("Zaman çizelgesi");
    expect(html).toContain("Atama zamanı");
    expect(html).toContain("Uyuşmazlık açıldı");

    expect(html).toContain("Ödeme denemeleri");
    expect(html).toContain("iyz-pay-000071");
    expect(html).toContain(`href="/payments/${PAYMENT_ID}"`);

    expect(html).toContain(PAYOUT_ID);
    expect(html).toContain(DISPUTE_ID);
    expect(html).toContain(REPORT_ID);
  });

  it("does not render an email even if the payload carries one", async () => {
    stubMe(ANALYST);
    const detail = adminAssignmentDetailFixture();
    watch({
      ...detail,
      worker: { ...(detail.worker as object), email: "private-worker@koala.test" },
    });

    const html = await render();

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).not.toContain("private-worker@koala.test");
  });
});

describe("links follow the reader's permissions", () => {
  it("shows linked ids as text when the reader cannot open them", async () => {
    stubMe(ANALYST);
    watch();

    const html = await render();

    expect(html).not.toContain(`href="/payout-reconciliation/${PAYOUT_ID}"`);
    expect(html).not.toContain(`href="/disputes/${DISPUTE_ID}"`);
    expect(html).not.toContain(`href="/reports/${REPORT_ID}"`);
    expect(html).not.toContain(`href="/jobs/${JOB_ID}"`);
    expect(html).toContain("payout.reconcile");
  });

  it("links payout, dispute, report and job when the permissions are held", async () => {
    stubMe(["payment.read", "payout.reconcile", "dispute.resolve", "content.moderate", "job.read"]);
    watch();

    const html = await render();

    expect(html).toContain(`href="/payout-reconciliation/${PAYOUT_ID}"`);
    expect(html).toContain(`href="/disputes/${DISPUTE_ID}"`);
    expect(html).toContain(`href="/reports/${REPORT_ID}"`);
    expect(html).toContain(`href="/jobs/${JOB_ID}"`);
  });
});

describe("escrow actions", () => {
  it("hides release and refund from payment.read alone", async () => {
    stubMe(ANALYST);
    watch();

    const html = await render();

    expect(html).toContain("release-permission-missing");
    expect(html).toContain("refund-permission-missing");
    expect(html).not.toContain("Çıkışı gözden geçir");
    expect(html).not.toContain("İadeyi gözden geçir");
  });

  it("draws both forms for payout.release and payment.refund holders", async () => {
    stubMe(["payment.read", "payout.release", "payment.refund"]);
    watch();

    const html = await render();

    expect(html).toContain("Çıkışı gözden geçir");
    expect(html).toContain("İadeyi gözden geçir");
    expect(html).not.toContain("release-permission-missing");
  });

  it("warns when a dispute is still open", async () => {
    stubMe(["payment.read", "payout.release"]);
    watch(
      adminAssignmentDetailFixture({
        disputes: [{ id: DISPUTE_ID, status: "OPEN", createdAt: "2026-09-02T09:00:00Z" }],
      }),
    );

    const html = await render();

    expect(html).toContain("open-dispute-notice");
  });
});

describe("empty and failed sub-loads", () => {
  it("says there are no attempts and no payout when the lists are empty", async () => {
    stubMe(ANALYST);
    watch(
      adminAssignmentDetailFixture({ payments: [], payout: null, disputes: [], reports: [] }),
      [],
    );

    const html = await render();

    expect(html).toContain("Bu atama için ödeme denemesi yok.");
    expect(html).toContain("Bu atama için hakediş oluşmamış.");
    expect(html).toContain("Bu atamaya bağlı uyuşmazlık yok.");
  });

  it("keeps the page when only the payments call fails", async () => {
    stubMe(ANALYST);
    server.use(
      http.get(DETAIL, () =>
        HttpResponse.json(
          envelope(`/admin/job-assignments/${ASSIGNMENT_ID}`, adminAssignmentDetailFixture()),
        ),
      ),
      http.get(PAYMENTS, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Ödeme servisi yanıt vermedi.",
            httpStatus: "502 BAD_GATEWAY",
            errorCode: "UPSTREAM_FAILED",
            errorCategory: "UPSTREAM_FAILED",
            requestId: "rid-502",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}/payments`,
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 502 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("Ödeme denemeleri yüklenemedi.");
    expect(html).toContain("rid-502");
  });

  it("renders a non-404 failure of the assignment itself in operator language", async () => {
    stubMe(ANALYST);
    server.use(
      http.get(DETAIL, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Yetkiniz yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-403",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}`,
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 403 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("Backend bu işlem için yetki vermedi.");
    expect(html).toContain("atama detayı");
    expect(html).toContain("rid-403");
  });
});

/** koala-admin#85: olmayan atama ortak 404 yüzeyidir, uyarı kutusu değil. */
describe("an assignment that does not exist", () => {
  it("calls notFound() on the backend's RESOURCE_NOT_FOUND", async () => {
    stubMe(ANALYST);
    let calls = 0;
    server.use(
      http.get(DETAIL, () => {
        calls += 1;
        return HttpResponse.json(
          {
            ...resourceNotFoundBody,
            errorCode: "JOB_ASSIGNMENT_NOT_FOUND",
            path: `/admin/job-assignments/${ASSIGNMENT_ID}`,
          },
          { status: 404 },
        );
      }),
    );

    const thrown = await renderServerComponent(
      <AssignmentDetailPage params={Promise.resolve({ id: ASSIGNMENT_ID })} />,
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
      <AssignmentDetailPage params={Promise.resolve({ id: "not-a-uuid" })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(seen.detail).toBe(0);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });
});
