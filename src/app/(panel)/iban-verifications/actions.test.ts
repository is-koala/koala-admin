import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";
import { INITIAL_IBAN_VERIFICATION_STATE } from "@/lib/iban-verification";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { submitIbanVerification } = await import("./actions");

const REFERENCE = "KOALA-9F3A2C";
const SENDER = "TR180006200119000006672315";
const ADMIN_ME = apiUrl("/admin/me");
const ACCOUNT_ID = "7c000000-0000-4000-8000-000000000048";

const GOOD_FIELDS = {
  reference: REFERENCE,
  senderIban: "TR18 0006 2001 1900 0006 6723 15",
  amount: "0.17",
  senderName: "",
};

const ACCOUNT = {
  id: ACCOUNT_ID,
  maskedIban: "TR18***2315",
  primary: true,
  verificationStatus: "VERIFIED",
};

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[]) {
  const seen = { calls: 0 };
  server.use(
    http.get(ADMIN_ME, () => {
      seen.calls += 1;
      return HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      });
    }),
  );
  return seen;
}

function success(data: unknown = ACCOUNT): Response {
  return HttpResponse.json({
    success: true,
    message: "IBAN doğrulaması tamamlandı.",
    httpStatus: "200 OK",
    path: `/admin/bank-account-verifications/${REFERENCE}/confirm`,
    requestId: "rid-iban",
    timeStamp: "2026-09-11T15:00:00Z",
    data,
  });
}

function watchConfirm(respond: () => Response = success) {
  const seen = { calls: 0, body: null as unknown, path: "" };
  server.use(
    http.post(
      apiUrl("/admin/bank-account-verifications/:reference/confirm"),
      async ({ request }) => {
        seen.calls += 1;
        seen.body = await request.json();
        seen.path = new URL(request.url).pathname;
        return respond();
      },
    ),
  );
  return seen;
}

function data(fields: Record<string, string> = GOOD_FIELDS): FormData {
  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  return formData;
}

function submit(fields: Record<string, string> = GOOD_FIELDS) {
  return submitIbanVerification(INITIAL_IBAN_VERIFICATION_STATE, data(fields));
}

describe("the IBAN confirm action fails closed", () => {
  it("re-resolves bank.account.verify and sends no POST for another finance permission", async () => {
    stubMe(["payout.reconcile", "finance.read"]);
    const confirm = watchConfirm();

    const state = await submit();

    expect(confirm.calls).toBe(0);
    expect(state.status).toBe("BLOCKED");
    expect(state.message).toContain("Banka hesaplarını doğrula");
  });

  it("re-resolves permission even when the IBAN is malformed", async () => {
    const me = stubMe(["bank.account.verify"]);
    const confirm = watchConfirm();

    await submit({ ...GOOD_FIELDS, senderIban: "TR18" });

    expect(me.calls).toBe(1);
    expect(confirm.calls).toBe(0);
  });

  it.each([
    ["reference", ""],
    ["senderIban", "DE89370400440532013000"],
    ["amount", "0.00"],
    ["amount", "1.234"],
    ["senderName", "x".repeat(256)],
  ])("sends no confirm request when %s is malformed", async (field, value) => {
    stubMe(["bank.account.verify"]);
    const confirm = watchConfirm();

    const state = await submit({ ...GOOD_FIELDS, [field]: value });

    expect(confirm.calls).toBe(0);
    expect(state.status).toBe("BLOCKED");
    expect(state.field).toBe(field);
  });
});

describe("the confirm action keeps the backend authoritative", () => {
  it("normalises spaced IBAN, keeps amount as decimal text, omits empty senderName", async () => {
    stubMe(["bank.account.verify"]);
    const confirm = watchConfirm();

    const state = await submit();

    expect(confirm.calls).toBe(1);
    expect(confirm.body).toEqual({
      senderIban: SENDER,
      amount: "0.17",
    });
    expect(typeof (confirm.body as { amount: unknown }).amount).toBe("string");
    expect(state.status).toBe("SUCCEEDED");
    expect(state.account).toEqual(ACCOUNT);
  });

  it("forwards an optional sender name when present", async () => {
    stubMe(["bank.account.verify"]);
    const confirm = watchConfirm();

    await submit({ ...GOOD_FIELDS, senderName: "  Ada Yılmaz  " });

    expect(confirm.body).toEqual({
      senderIban: SENDER,
      amount: "0.17",
      senderName: "Ada Yılmaz",
    });
  });

  it.each([
    [
      400,
      "BANK_ACCOUNT_VERIFICATION_SENDER_MISMATCH",
      "Transferi gönderen hesap kayıtlı IBAN ile aynı değil, doğrulama tamamlanmadı.",
    ],
    [
      400,
      "BANK_ACCOUNT_VERIFICATION_AMOUNT_MISMATCH",
      "Gelen transferin tutarı beklenen tutarla aynı değil, doğrulama tamamlanmadı.",
    ],
    [
      404,
      "BANK_ACCOUNT_VERIFICATION_NOT_FOUND",
      "Bu referansla bekleyen bir IBAN doğrulaması bulunamadı.",
    ],
    [409, "BANK_ACCOUNT_VERIFICATION_ALREADY_VERIFIED", "Bu banka hesabı zaten doğrulanmış."],
  ])("keeps a backend %i message and request id", async (status, errorCode, message) => {
    stubMe(["bank.account.verify"]);
    watchConfirm(() =>
      HttpResponse.json(
        {
          success: false,
          message,
          httpStatus: `${status} ERROR`,
          errorCode,
          errorCategory:
            status === 404
              ? "RESOURCE_NOT_FOUND"
              : status === 409
                ? "DATA_CONFLICT"
                : "BUSINESS_RULE_VIOLATION",
          requestId: `rid-${status}`,
          path: `/admin/bank-account-verifications/${REFERENCE}/confirm`,
          timeStamp: "2026-09-11T15:00:00Z",
        },
        { status },
      ),
    );

    const state = await submit();

    expect(state.status).toBe("REFUSED");
    expect(state.message).toBe(message);
    expect(state.errorCode).toBe(errorCode);
    expect(state.requestId).toBe(`rid-${status}`);
    expect(state.account).toBeNull();
  });

  it("does not expose a backend 5xx detail", async () => {
    stubMe(["bank.account.verify"]);
    watchConfirm(() =>
      HttpResponse.json(
        {
          success: false,
          message: "jdbc:postgresql://internal:5432/koala user=secret",
          httpStatus: "500 INTERNAL_SERVER_ERROR",
          errorCode: "UNEXPECTED",
          errorCategory: "UNEXPECTED",
          requestId: "rid-500",
          path: `/admin/bank-account-verifications/${REFERENCE}/confirm`,
          timeStamp: "2026-09-11T15:00:00Z",
        },
        { status: 500 },
      ),
    );

    const state = await submit();

    expect(state.message).toBe("Doğrulama gönderilemedi. Lütfen tekrar deneyin.");
    expect(state.message).not.toContain("postgresql");
    expect(state.requestId).toBe("rid-500");
  });

  it("does not report success unless verificationStatus is VERIFIED", async () => {
    stubMe(["bank.account.verify"]);
    watchConfirm(() => success({ ...ACCOUNT, verificationStatus: "PENDING" }));

    const state = await submit();

    expect(state.status).toBe("REFUSED");
    expect(state.account).toBeNull();
    expect(state.message).toContain("doğrulanamadı");
  });
});
