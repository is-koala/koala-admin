import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { renderServerComponent } from "../../../test/render-server";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  requireStaffSession: () => Promise.resolve(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

const { default: PanelHomePage } = await import("./page");

const ADMIN_ME = apiUrl("/admin/me");

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
});

function stubMe(permissions: readonly string[], roles: readonly string[] = ["TRUST_LEAD"]) {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, roles: [...roles], permissions: [...permissions] },
      }),
    ),
  );
}

function emptyPage(totalElements: number) {
  return {
    content: [],
    page: 0,
    size: 1,
    totalElements,
    totalPages: totalElements === 0 ? 0 : 1,
    first: true,
    last: true,
  };
}

function watchQueues() {
  const seen: string[] = [];
  server.use(
    http.get(apiUrl("/admin/identity-verifications"), ({ request }) => {
      seen.push(`identity:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/identity-verifications",
        requestId: "rid-id",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(4),
      });
    }),
    http.get(apiUrl("/admin/reports"), ({ request }) => {
      seen.push(`reports:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/reports",
        requestId: "rid-rep",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(7),
      });
    }),
    http.get(apiUrl("/admin/companies"), ({ request }) => {
      seen.push(`companies:${new URL(request.url).searchParams.get("status")}`);
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/companies",
        requestId: "rid-co",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(2),
      });
    }),
    http.get(apiUrl("/admin/disputes"), () => {
      seen.push("disputes");
      return HttpResponse.json({
        success: true,
        message: "ok",
        httpStatus: "200 OK",
        path: "/admin/disputes",
        requestId: "rid-d",
        timeStamp: "2026-09-11T12:00:00.000000000Z",
        data: emptyPage(3),
      });
    }),
  );
  return seen;
}

const render = async () =>
  (await renderServerComponent(<PanelHomePage />)).replaceAll("<!-- -->", "");

describe("Güncel durum", () => {
  it("shows live queue counts for the permissions the actor holds and never advertises the verification page", async () => {
    stubMe(["identity.review", "content.moderate", "company.approve", "dispute.resolve"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(
      expect.arrayContaining(["identity:PENDING", "reports:OPEN", "companies:PENDING", "disputes"]),
    );
    expect(html).toContain("Kimlik incelemeleri");
    expect(html).toContain("4");
    expect(html).toContain("Şikayetler");
    expect(html).toContain("7");
    expect(html).toContain("Şirket onayları");
    expect(html).toContain("2");
    expect(html).toContain("Uyuşmazlıklar");
    expect(html).toContain("3");
    expect(html).toContain('href="/identity-reviews"');
    expect(html).not.toContain("İş kategorileri (doğrulama)");
    expect(html).not.toContain("/verification/job-categories");
    expect(html).not.toContain("ACCESS-TOKEN");
  });

  it("does not ask queues the actor cannot open", async () => {
    stubMe(["content.moderate"]);
    const seen = watchQueues();

    const html = await render();

    expect(seen).toEqual(["reports:OPEN"]);
    expect(html).toContain("Şikayetler");
    expect(html).not.toContain("Kimlik incelemeleri");
    expect(html).not.toContain("Uyuşmazlıklar");
  });
});
