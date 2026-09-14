import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  confirmIbanVerification,
  findPendingIbanVerification,
  getPendingIbanVerifications,
  IBAN_PENDING_PATH,
  IBAN_PENDING_PAGING,
  ibanPendingAmountText,
  ibanVerificationConfirmPath,
} from "./iban-verification";

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

const PENDING = {
  accountId: "7c000000-0000-4000-8000-000000000048",
  user: { id: "u-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
  maskedIban: "TR18***2315",
  reference: REFERENCE,
  amount: 0.17,
  startedAt: "2026-09-11T12:00:00Z",
  expiresAt: "2026-09-12T12:00:00Z",
  createdAt: "2026-09-11T11:00:00Z",
};

function pageSuccess(content: unknown[] = [PENDING]): Response {
  return HttpResponse.json({
    success: true,
    message: "Bekleyen doğrulamalar listelendi.",
    httpStatus: "200 OK",
    path: IBAN_PENDING_PATH,
    requestId: "rid-iban-list",
    timeStamp: "2026-09-11T15:00:00Z",
    data: {
      content,
      page: 0,
      size: 20,
      totalElements: content.length,
      totalPages: 1,
      first: true,
      last: true,
    },
  });
}

describe("the pending IBAN queue", () => {
  it("asks for PENDING and the default verificationStartedAt sort", async () => {
    let url: URL | null = null;
    server.use(
      http.get(apiUrl(IBAN_PENDING_PATH), ({ request }) => {
        url = new URL(request.url);
        return pageSuccess();
      }),
    );

    const page = await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
    });

    expect(url).not.toBeNull();
    const params = url as unknown as URL;
    expect(params.searchParams.get("status")).toBe("PENDING");
    expect(params.searchParams.has("query")).toBe(false);
    expect(params.searchParams.get("sort")).toBe("verificationStartedAt,desc");
    expect(page.content[0]?.maskedIban).toBe("TR18***2315");
    expect(page.content[0]).not.toHaveProperty("iban");
  });

  it("keeps a decimal amount as text so confirm-from-row does not invent precision", () => {
    expect(ibanPendingAmountText(0.17)).toBe("0.17");
    expect(ibanPendingAmountText("0.17")).toBe("0.17");
    expect(ibanPendingAmountText(null)).toBe("");
  });

  it("drops a leaked full IBAN so the table cannot render it", async () => {
    server.use(
      http.get(apiUrl(IBAN_PENDING_PATH), () =>
        pageSuccess([{ ...PENDING, iban: "TR180006200119000006672315" }]),
      ),
    );

    const page = await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
    });

    expect(page.content[0]).not.toHaveProperty("iban");
    expect(page.content[0]?.maskedIban).toBe("TR18***2315");
  });
});

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

function searchEnvelope(path: string) {
  return {
    success: true,
    message: "Listelendi.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-search",
    timeStamp: "2026-09-14T08:00:00Z",
    data: {
      content: [],
      page: 0,
      size: 20,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
    },
  };
}

/**
 * koala-backend#263: `query` 2–100 karakter, kırpılmış; kısa değer süzmez.
 * Kuralın kendisi `search-query.test.ts`'de; burada yalnız bu kurucunun ona
 * uyduğu ve parametreyi backend'in beklediği adla gönderdiği sabitlenir.
 */
describe("the IBAN queue search goes to the backend as query", () => {
  function watchSearch() {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(IBAN_PENDING_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(searchEnvelope(IBAN_PENDING_PATH));
      }),
    );
    return seen;
  }

  it("forwards a trimmed search as query", async () => {
    const seen = watchSearch();

    await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
      query: "  Ayşe Yılmaz  ",
    });

    expect(seen.url?.searchParams.get("query")).toBe("Ayşe Yılmaz");
  });

  it("sends no query for one character, and clips at 100", async () => {
    const seen = watchSearch();

    await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
      query: "a",
    });
    expect(seen.url?.searchParams.has("query")).toBe(false);

    await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
      query: "k".repeat(120),
    });
    expect(seen.url?.searchParams.get("query")).toHaveLength(100);
  });
});

/** koala-admin#95: tekil uç yok; nesne kuyruğun referansla süzülmüş tam eşleşmesidir. */
describe("findPendingIbanVerification", () => {
  it("filters the PENDING queue by the reference and returns the exact match", async () => {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(IBAN_PENDING_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return pageSuccess([
          {
            ...PENDING,
            reference: `${REFERENCE}Z`,
            accountId: "7c000000-0000-4000-8000-000000000049",
          },
          PENDING,
        ]);
      }),
    );

    const found = await findPendingIbanVerification("TOKEN", REFERENCE);

    expect(seen.url?.searchParams.get("status")).toBe("PENDING");
    expect(seen.url?.searchParams.get("query")).toBe(REFERENCE);
    expect(found?.accountId).toBe(PENDING.accountId);
  });

  it("returns null when only prefix matches or nothing comes back", async () => {
    server.use(
      http.get(apiUrl(IBAN_PENDING_PATH), () =>
        pageSuccess([{ ...PENDING, reference: `${REFERENCE}Z` }]),
      ),
    );
    expect(await findPendingIbanVerification("TOKEN", REFERENCE)).toBeNull();

    server.use(http.get(apiUrl(IBAN_PENDING_PATH), () => pageSuccess([])));
    expect(await findPendingIbanVerification("TOKEN", REFERENCE)).toBeNull();
  });
});

/** koala-admin#100 / koala-backend#283: `status` ve `attemptsLeft`; eski sunucuda `null`. */
describe("status and attempts left", () => {
  it("reads both when present and nulls them for a #265 server", async () => {
    let content: unknown[] = [{ ...PENDING, status: "PENDING", attemptsLeft: 2 }];
    server.use(http.get(apiUrl(IBAN_PENDING_PATH), () => pageSuccess(content)));

    const page = await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
    });
    expect(page.content[0]?.status).toBe("PENDING");
    expect(page.content[0]?.attemptsLeft).toBe(2);

    content = [PENDING];
    const legacy = await getPendingIbanVerifications("ACCESS-TOKEN", {
      paging: { page: 0, size: 20, sort: IBAN_PENDING_PAGING.defaultSort },
    });
    expect(legacy.content[0]?.status).toBeNull();
    expect(legacy.content[0]?.attemptsLeft).toBeNull();
  });
});
