import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { confirmIbanVerification, ibanVerificationConfirmPath } from "./iban-verification";

const REFERENCE = "KOALA-9F3A2C";
const CONFIRM = apiUrl(ibanVerificationConfirmPath(REFERENCE));
const SENDER = "TR180006200119000006672315";

const ACCOUNT = {
  id: "7c000000-0000-4000-8000-000000000048",
  maskedIban: "TR18***2315",
  primary: true,
  verificationStatus: "VERIFIED",
};

const OBSERVATION = {
  senderIban: SENDER,
  amount: "0.17",
};

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

describe("IBAN verification confirm transport", () => {
  it("posts decimal amount as text and keeps the masked IBAN", async () => {
    let body: unknown = null;
    let authorization: string | null = null;
    server.use(
      http.post(CONFIRM, async ({ request }) => {
        body = await request.json();
        authorization = request.headers.get("authorization");
        return success();
      }),
    );

    const account = await confirmIbanVerification("ACCESS-TOKEN", REFERENCE, OBSERVATION);

    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(body).toEqual(OBSERVATION);
    expect(typeof (body as { amount: unknown }).amount).toBe("string");
    expect(account).toEqual(ACCOUNT);
  });

  it("omits senderName when the operator did not supply one", async () => {
    let body: unknown = null;
    server.use(
      http.post(CONFIRM, async ({ request }) => {
        body = await request.json();
        return success();
      }),
    );

    await confirmIbanVerification("ACCESS-TOKEN", REFERENCE, OBSERVATION);

    expect(body).not.toHaveProperty("senderName");
  });

  it("escapes the reference rather than letting it alter the path", async () => {
    let url = "";
    server.use(
      http.post(apiUrl("/admin/bank-account-verifications/*/confirm"), ({ request }) => {
        url = request.url;
        return success();
      }),
    );

    await confirmIbanVerification("ACCESS-TOKEN", "../other", OBSERVATION);

    expect(url).toContain("%2F");
  });
});
