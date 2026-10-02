import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { isKoalaApiError } from "./errors";
import {
  getIdentityReveals,
  IDENTITY_REVEAL_PAGE_PARAM,
  IDENTITY_REVEAL_PAGING,
  readIdentityRevealPaging,
  userIdentityRevealsPath,
} from "./identity-reveals";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";
const VIEWER_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const ASSIGNMENT_ID = "9a1c0f10-0001-4c00-8000-0000000000aa";
const JOB_ID = "9a1c0f10-0002-4c00-8000-0000000000bb";

/**
 * `GET /admin/users/{userId}/identity-reveals` — `user.read_pii`
 * (koala-backend 0.9.27, `AdminController.userIdentityReveals`). Gövde
 * `PageDto<AdminIdentityRevealDto>`; DTO TCKN taşımaz, IP maskelidir.
 */

const REVEAL = {
  id: "7e000000-0000-4000-8000-000000000001",
  viewerId: VIEWER_ID,
  viewerFullName: "Mert Demir",
  jobAssignmentId: ASSIGNMENT_ID,
  jobId: JOB_ID,
  jobTitle: "Cumartesi garson",
  revealedAt: "2026-09-16T08:30:00Z",
  ipAddress: "203.0.113.***",
};

function pageEnvelope(content: readonly unknown[], overrides: Record<string, unknown> = {}) {
  return HttpResponse.json({
    success: true,
    message: "Kimlik görüntüleme kayıtları listelendi.",
    httpStatus: "200 OK",
    path: userIdentityRevealsPath(USER_ID),
    requestId: "rid-reveals",
    timeStamp: "2026-09-16T09:00:00.000000000Z",
    data: {
      content,
      page: 0,
      size: 20,
      totalElements: content.length,
      totalPages: content.length === 0 ? 0 : 1,
      first: true,
      last: true,
      ...overrides,
    },
  });
}

describe("the identity reveals GET", () => {
  it("asks the user's sub-resource with the bearer token, one page and the only sort the backend accepts", async () => {
    let url: URL | null = null;
    let authorization: string | null = null;
    server.use(
      http.get(apiUrl(userIdentityRevealsPath(USER_ID)), ({ request }) => {
        url = new URL(request.url);
        authorization = request.headers.get("authorization");
        return pageEnvelope([REVEAL]);
      }),
    );

    const page = await getIdentityReveals(
      "ACCESS-TOKEN",
      USER_ID,
      readIdentityRevealPaging({ [IDENTITY_REVEAL_PAGE_PARAM]: "2" }),
    );

    expect(userIdentityRevealsPath(USER_ID)).toBe(`/admin/users/${USER_ID}/identity-reveals`);
    expect(url).not.toBeNull();
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(url!.pathname).toBe(`/admin/users/${USER_ID}/identity-reveals`);
    expect(url!.searchParams.get("page")).toBe("2");
    expect(url!.searchParams.get("size")).toBe("20");
    expect(url!.searchParams.get("sort")).toBe("revealedAt,desc");
    expect(page.content).toEqual([REVEAL]);
    expect(page.totalElements).toBe(1);
  });

  it("keeps the backend's order and strips what the contract does not name", async () => {
    server.use(
      http.get(apiUrl(userIdentityRevealsPath(USER_ID)), () =>
        pageEnvelope([
          { ...REVEAL, identityNumber: "must-be-stripped", viewerEmail: "must-be-stripped" },
          { ...REVEAL, id: "7e000000-0000-4000-8000-000000000002" },
        ]),
      ),
    );

    const page = await getIdentityReveals("ACCESS-TOKEN", USER_ID, readIdentityRevealPaging({}));

    expect(page.content.map((row) => row.id)).toEqual([
      "7e000000-0000-4000-8000-000000000001",
      "7e000000-0000-4000-8000-000000000002",
    ]);
    expect(page.content[0]).not.toHaveProperty("identityNumber");
    expect(page.content[0]).not.toHaveProperty("viewerEmail");
  });

  /**
   * `viewerFullName` iki durumda `null` döner (`DisplayNames.of`): görüntüleyen
   * hesabını silmiş (satır ve `viewerId` kalır) ya da canlı hesabın iki adı da
   * boş. IP sütunu da nullable.
   */
  it("reads a row whose viewer has no name and keeps its id", async () => {
    server.use(
      http.get(apiUrl(userIdentityRevealsPath(USER_ID)), () =>
        pageEnvelope([{ ...REVEAL, viewerFullName: null, ipAddress: null, jobTitle: null }]),
      ),
    );

    const page = await getIdentityReveals("ACCESS-TOKEN", USER_ID, readIdentityRevealPaging({}));

    expect(page.content[0]).toMatchObject({
      viewerId: VIEWER_ID,
      viewerFullName: null,
      ipAddress: null,
      jobTitle: null,
    });
  });

  /**
   * `revealedAt` backend'de `Instant`, `nullable = false`: kayıt "ne zaman"sız
   * olamaz. Gelmeyen bir an boş hücre olarak sessizce geçmesin, sözleşme
   * kayması olarak yüklenemedi ekranına düşsün.
   */
  it("refuses a row without the instant it records", async () => {
    server.use(
      http.get(apiUrl(userIdentityRevealsPath(USER_ID)), () =>
        pageEnvelope([{ ...REVEAL, revealedAt: undefined }]),
      ),
    );

    await expect(
      getIdentityReveals("ACCESS-TOKEN", USER_ID, readIdentityRevealPaging({})),
    ).rejects.toBeDefined();
  });

  it("surfaces a refusal as a KoalaApiError with the request id, not as an empty page", async () => {
    server.use(
      http.get(apiUrl(userIdentityRevealsPath(USER_ID)), () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu işlem için yetki yok.",
            httpStatus: "403 FORBIDDEN",
            errorCode: "ACCESS_DENIED",
            errorCategory: "ACCESS_DENIED",
            requestId: "rid-reveals-403",
            path: userIdentityRevealsPath(USER_ID),
            timeStamp: "2026-09-16T09:00:00.000000000Z",
          },
          { status: 403 },
        ),
      ),
    );

    const error = await getIdentityReveals(
      "ACCESS-TOKEN",
      USER_ID,
      readIdentityRevealPaging({}),
    ).catch((caught: unknown) => caught);

    expect(isKoalaApiError(error)).toBe(true);
    if (!isKoalaApiError(error)) throw new Error("unreachable");
    expect(error.status).toBe(403);
    expect(error.requestId).toBe("rid-reveals-403");
  });
});

describe("the identity reveals page parameter", () => {
  /**
   * `sayfa` değil: nesne sayfasında `sayfa` liste görünümünün anahtarıdır
   * (`QUEUE_STATE_KEYS`) ve kırıntı onu "kullanıcı listesinin kaçıncı
   * sayfası" diye geri okur. Sekmenin kendi sayfalayıcısı ona dokunmaz.
   */
  it("is not the queue state's sayfa, so paging does not rewrite the breadcrumb", () => {
    expect(IDENTITY_REVEAL_PAGE_PARAM).not.toBe("sayfa");
    expect(readIdentityRevealPaging({ sayfa: "4" }).page).toBe(0);
  });

  it("clamps what a person can type in the address bar to a page the backend accepts", () => {
    const read = (value: string) =>
      readIdentityRevealPaging({ [IDENTITY_REVEAL_PAGE_PARAM]: value }).page;

    expect(read("3")).toBe(3);
    expect(read("-1")).toBe(0);
    expect(read("banana")).toBe(0);
    expect(read("2.9")).toBe(2);
    expect(readIdentityRevealPaging({}).page).toBe(0);
  });

  it("copies the backend's sort contract and default page size", () => {
    expect(IDENTITY_REVEAL_PAGING.sortable).toEqual(["revealedAt"]);
    expect(readIdentityRevealPaging({})).toEqual({
      page: 0,
      size: 20,
      sort: { field: "revealedAt", direction: "desc" },
    });
  });
});
