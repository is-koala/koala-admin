import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeNoStaffRecordBody, adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";

/**
 * The guard that stands in front of both decision actions.
 *
 * A Server Action is a POST endpoint. `<RequirePermission>` never runs for it —
 * it gated the page that rendered the form, and the form is not what an
 * attacker submits. So the interesting assertions here are the refusals: a
 * MODERATOR must not be able to approve a company by posting to the company
 * action, and a panel that cannot resolve permissions at all must refuse rather
 * than assume.
 */

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
}));

const { KoalaApiError } = await import("@/server/api/errors");
const { classifyQueueFailure, decisionFailureFrom, guardDecision } = await import("./decisions");

const ADMIN_ME = apiUrl("/admin/me");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

describe("a decision action re-checks the permission it needs", () => {
  it("lets a holder through", async () => {
    stubMe(["content.moderate"]);

    expect(await guardDecision("content.moderate")).toBeNull();
  });

  it("refuses a MODERATOR who posts to the company approval action", async () => {
    // The exact separation koala-admin#7 and #8 are built on: content.moderate
    // is not company.approve, and the form being on another page is no defence.
    stubMe(["content.moderate"]);

    const denied = await guardDecision("company.approve");

    expect(denied?.outcome).toBe("error");
    expect(denied?.message).toContain("Şirket başvurularını onayla");
  });

  it("refuses when the panel could not find out what the caller may do", async () => {
    server.use(
      http.get(ADMIN_ME, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Beklenmedik bir hata oluştu.",
            httpStatus: "500 INTERNAL_SERVER_ERROR",
            errorCode: "UNEXPECTED",
            errorCategory: "UNEXPECTED",
            requestId: "rid-500",
            path: "/admin/me",
            timeStamp: "2026-09-06T09:22:00.000000000Z",
          },
          { status: 500 },
        ),
      ),
    );

    const denied = await guardDecision("content.moderate");

    // Not "you lack permission" — the panel does not know that.
    expect(denied?.message).toContain("İzinleriniz çözülemediği için");
    expect(denied?.requestId).toBe("rid-500");
  });

  it("refuses a Keycloak identity with no staff record", async () => {
    server.use(
      http.get(ADMIN_ME, () => HttpResponse.json(adminMeNoStaffRecordBody, { status: 403 })),
    );

    expect(await guardDecision("company.approve")).not.toBeNull();
  });
});

describe("how a failed queue load is described", () => {
  it("separates a refusal from a breakage", () => {
    const forbidden = classifyQueueFailure(
      new KoalaApiError({
        status: 403,
        errorCode: "ACCESS_DENIED",
        errorCategory: "ACCESS_DENIED",
        message: "Bu işlem için yetkiniz yok.",
        requestId: "rid-403",
      }),
    );

    expect(forbidden).toEqual({
      kind: "forbidden",
      errorCode: "ACCESS_DENIED",
      requestId: "rid-403",
    });
  });

  it("keeps the backend's own words for anything else", () => {
    const failure = classifyQueueFailure(
      new KoalaApiError({
        status: 0,
        errorCode: "NETWORK_FAILURE",
        errorCategory: "UPSTREAM_FAILED",
        message: "Koala API'ye ulaşılamadı.",
      }),
    );

    expect(failure).toEqual({
      kind: "error",
      message: "Koala API'ye ulaşılamadı.",
      errorCode: "NETWORK_FAILURE",
      requestId: null,
    });
  });

  it("survives something that is not a Koala error at all", () => {
    expect(classifyQueueFailure("kaboom")).toEqual({
      kind: "error",
      message: "Bilinmeyen bir hata oluştu.",
      errorCode: null,
      requestId: null,
    });
  });
});

describe("how a refused decision is described", () => {
  it("tells the operator a 409 means somebody else already decided", () => {
    // Both endpoints answer 409 for exactly this. Retrying is the wrong move
    // and "conflict" does not say so.
    const state = decisionFailureFrom(
      new KoalaApiError({
        status: 409,
        errorCode: "REPORT_ALREADY_REVIEWED",
        errorCategory: "DATA_CONFLICT",
        message: "Şikayet zaten sonuçlandırılmış.",
        requestId: "rid-409",
      }),
      "Karar gönderilemedi.",
    );

    expect(state.message).toContain("sizden önce sonuçlandırılmış olabilir");
    expect(state.requestId).toBe("rid-409");
  });

  it("says a 403 is the backend's answer, not the panel's", () => {
    const state = decisionFailureFrom(
      new KoalaApiError({
        status: 403,
        errorCode: "ACCESS_DENIED",
        errorCategory: "ACCESS_DENIED",
        message: "Bu işlem için yetkiniz yok.",
        requestId: null,
      }),
      "Karar gönderilemedi.",
    );

    expect(state.message).toContain("Yetki kararını backend verir.");
  });
});
