import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pageEnvelope } from "../../../../test/fixtures/admin-detail";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
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

const { default: IbanVerificationDetailPage } = await import("./[reference]/page");

const ADMIN_ME = apiUrl("/admin/me");
const QUEUE = apiUrl("/admin/bank-account-verifications");
const REFERENCE = "KOALA-9F3A";
const ACCOUNT_ID = "3b000000-0000-4000-8000-000000000031";

const OFFICER = ["bank.account.verify"];

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

function pendingRow(overrides: Record<string, unknown> = {}) {
  return {
    accountId: ACCOUNT_ID,
    user: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
    maskedIban: "TR** **** **** **** **** **12 34",
    reference: REFERENCE,
    amount: 0.17,
    startedAt: "2026-09-12T08:00:00.000000000Z",
    expiresAt: "2026-09-15T08:00:00.000000000Z",
    createdAt: "2026-09-12T07:59:00.000000000Z",
    ...overrides,
  };
}

function watchQueue(rows: unknown[] = [pendingRow()]) {
  const seen = { calls: 0, url: null as URL | null, authorization: null as string | null };
  server.use(
    http.get(QUEUE, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.authorization = request.headers.get("authorization");
      return HttpResponse.json(pageEnvelope("/admin/bank-account-verifications", rows));
    }),
  );
  return seen;
}

const render = async (reference: string = REFERENCE) =>
  (
    await renderServerComponent(
      <IbanVerificationDetailPage params={Promise.resolve({ reference })} />,
    )
  ).replaceAll("<!-- -->", "");

describe("who can open an IBAN verification", () => {
  it("refuses a payout.reconcile holder and never asks the queue", async () => {
    stubMe(["payout.reconcile"]);
    const seen = watchQueue();

    const html = await render();

    expect(seen.calls).toBe(0);
    expect(html).toContain("403 — Bu sayfa için yetkiniz yok");
    expect(html).toContain("Banka hesaplarını doğrula");
    expect(html).not.toContain("Ayşe Yılmaz");
  });

  it("builds the object from the PENDING queue filtered by the reference", async () => {
    stubMe(OFFICER);
    const seen = watchQueue();

    const html = await render();

    expect(seen.calls).toBe(1);
    expect(seen.authorization).toBe("Bearer ACCESS-TOKEN");
    expect(seen.url?.searchParams.get("status")).toBe("PENDING");
    expect(seen.url?.searchParams.get("query")).toBe(REFERENCE);
    expect(html).not.toContain("ACCESS-TOKEN");

    expect(html).toContain("Ayşe Yılmaz");
    expect(html).toContain("TR** **** **** **** **** **12 34");
    expect(html).toContain(REFERENCE);
    expect(html).toContain(ACCOUNT_ID);
    expect(html).toContain("₺0,17");
    expect(html).toContain("Bekliyor");
    expect(html).toContain("Zaman çizelgesi");
    expect(html).toContain("12.09.2026 11:00");
    expect(html).toContain("15.09.2026 11:00");
  });

  it("prefills the confirm form with the reference and the expected amount", async () => {
    stubMe(OFFICER);
    watchQueue();

    const html = await render();

    expect(html).toContain("Ekstre onayı");
    expect(html).toContain(`value="${REFERENCE}"`);
    expect(html).toContain('value="0.17"');
  });

  it("does not render an email even if the payload carries one", async () => {
    stubMe(OFFICER);
    watchQueue([
      pendingRow({
        user: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", email: "private@koala.test" },
      }),
    ]);

    const html = await render();

    expect(html).not.toContain("private@koala.test");
  });

  it("renders a queue failure in operator language", async () => {
    stubMe(OFFICER);
    server.use(
      http.get(QUEUE, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmeyen hata.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/bank-account-verifications",
            timeStamp: "2026-09-14T08:00:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );

    const html = await render();

    expect(html).toContain("IBAN doğrulaması yüklenemedi.");
    expect(html).toContain("rid-500");
  });
});

/** koala-admin#85: kuyrukta olmayan referans ortak 404 yüzeyidir. */
describe("a reference that is not pending", () => {
  it("calls notFound() when the queue has no exact match, even a prefix one", async () => {
    stubMe(OFFICER);
    const seen = watchQueue([
      pendingRow({ reference: `${REFERENCE}1`, accountId: "3b000000-0000-4000-8000-000000000032" }),
    ]);

    const thrown = await renderServerComponent(
      <IbanVerificationDetailPage params={Promise.resolve({ reference: REFERENCE })} />,
    ).then(
      () => null,
      (error: unknown) => error,
    );

    expect(seen.calls).toBe(1);
    expect((thrown as { digest?: string } | null)?.digest).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("treats an over-long or undecodable reference the same way, without asking the backend", async () => {
    stubMe(OFFICER);
    const seen = watchQueue();

    for (const reference of ["k".repeat(129), "%E0%A4%A", "%20%20"]) {
      const thrown = await renderServerComponent(
        <IbanVerificationDetailPage params={Promise.resolve({ reference })} />,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect((thrown as { digest?: string } | null)?.digest, reference).toBe(
        "NEXT_HTTP_ERROR_FALLBACK;404",
      );
    }

    expect(seen.calls).toBe(0);
  });
});

/** koala-admin#100 / koala-backend#283: kalan deneme hakkı; eski sunucuda "—". */
describe("the attempts left", () => {
  it("draws attemptsLeft when the DTO carries it and the empty value when it does not", async () => {
    stubMe(OFFICER);
    watchQueue([pendingRow({ attemptsLeft: 2, status: "PENDING" })]);
    const html = await render();
    expect(html).toMatch(/Kalan deneme<\/dt><dd[^>]*><span[^>]*>2</);

    stubMe(OFFICER);
    watchQueue([pendingRow()]);
    const legacy = await render();
    expect(legacy).toMatch(/Kalan deneme<\/dt><dd[^>]*>—</);
  });
});
