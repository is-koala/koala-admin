import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  companyContactRoleLabel,
  getMarketplaceUser,
  identityReviewStatusLabel,
  MARKETPLACE_USERS_PATH,
} from "./marketplace-users";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("the marketplace user object GET", () => {
  /**
   * Eski sunucu (`SafeUserDto`) — koala-backend#283 alanları yok. Şema
   * hepsini `null` okur; sayfa bölümleri gizler. E-posta artık bir alan:
   * backend onu yalnız `user.read_pii` taşıyan aktöre doldurur, panel
   * gelen değeri olduğu gibi okur ve satırı izne göre çizer.
   */
  it("reads a SafeUserDto server as a detail with every extension empty", async () => {
    let url: string | null = null;
    let authorization: string | null = null;

    server.use(
      http.get(apiUrl(`${MARKETPLACE_USERS_PATH}/${USER_ID}`), ({ request }) => {
        url = request.url;
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          message: "Kullanıcı getirildi.",
          httpStatus: "200 OK",
          path: `${MARKETPLACE_USERS_PATH}/${USER_ID}`,
          requestId: "rid-user",
          timeStamp: "2026-09-12T00:00:00.000000000Z",
          data: {
            id: USER_ID,
            firstName: "Berk",
            lastName: "Yılmaz",
            username: "berk",
            profilePictureUrl: null,
          },
        });
      }),
    );

    const user = await getMarketplaceUser("ACCESS-TOKEN", USER_ID);

    expect(url).toBe(apiUrl(`${MARKETPLACE_USERS_PATH}/${USER_ID}`));
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(user).toEqual({
      id: USER_ID,
      firstName: "Berk",
      lastName: "Yılmaz",
      username: "berk",
      profilePictureUrl: null,
      email: null,
      phoneNumber: null,
      emailVerified: null,
      phoneVerified: null,
      identityVerified: null,
      isEmployer: null,
      createdAt: null,
      companies: null,
      badges: null,
      counts: null,
      identityReviewStatus: null,
      pendingDeletionRequestId: null,
    });
  });

  it("reads the full AdminUserDetailDto and keeps [] apart from an absent list", async () => {
    server.use(
      http.get(apiUrl(`${MARKETPLACE_USERS_PATH}/${USER_ID}`), () =>
        HttpResponse.json({
          success: true,
          message: "Kullanıcı getirildi.",
          httpStatus: "200 OK",
          path: `${MARKETPLACE_USERS_PATH}/${USER_ID}`,
          requestId: "rid-user",
          timeStamp: "2026-09-12T00:00:00.000000000Z",
          data: {
            id: USER_ID,
            firstName: "Berk",
            lastName: "Yılmaz",
            username: "berk",
            profilePictureUrl: null,
            email: "berk@koala.test",
            phoneNumber: "+905550000000",
            emailVerified: true,
            phoneVerified: false,
            identityVerified: true,
            isEmployer: true,
            createdAt: "2026-01-05T10:00:00Z",
            companies: [{ id: "c-1", name: "Koala Kafe", role: "ADMIN" }],
            badges: [],
            counts: {
              applications: 3,
              assignmentsAsWorker: 2,
              assignmentsAsEmployer: 5,
              payments: 4,
              payouts: 1,
              disputes: 0,
              reportsReceived: 1,
              reportsMade: 2,
            },
            identityReviewStatus: "APPROVED",
            pendingDeletionRequestId: null,
            passwordHash: "must-be-stripped",
          },
        }),
      ),
    );

    const user = await getMarketplaceUser("ACCESS-TOKEN", USER_ID);

    expect(user.email).toBe("berk@koala.test");
    expect(user.phoneVerified).toBe(false);
    expect(user.companies).toEqual([{ id: "c-1", name: "Koala Kafe", role: "ADMIN" }]);
    expect(user.badges).toEqual([]);
    expect(user.counts?.assignmentsAsEmployer).toBe(5);
    expect(user.identityReviewStatus).toBe("APPROVED");
    expect(JSON.stringify(user)).not.toContain("must-be-stripped");
  });

  /** İnceleme durumu ve üyelik rolü yalnız gösterim: bilinmeyen kod sayfayı düşürmez, etiket kodu yazar. */
  it("keeps an identity review status or membership role it cannot label and labels it by its code", async () => {
    server.use(
      http.get(apiUrl(`${MARKETPLACE_USERS_PATH}/${USER_ID}`), () =>
        HttpResponse.json({
          success: true,
          message: "Kullanıcı getirildi.",
          httpStatus: "200 OK",
          path: `${MARKETPLACE_USERS_PATH}/${USER_ID}`,
          requestId: "rid-user",
          timeStamp: "2026-09-12T00:00:00.000000000Z",
          data: {
            id: USER_ID,
            identityReviewStatus: "ESCALATED",
            companies: [{ id: "c-1", name: "Koala Kafe", role: "OWNER" }],
          },
        }),
      ),
    );

    const user = await getMarketplaceUser("ACCESS-TOKEN", USER_ID);
    expect(user.identityReviewStatus).toBe("ESCALATED");
    expect(identityReviewStatusLabel("ESCALATED")).toBe("ESCALATED");
    expect(identityReviewStatusLabel("APPROVED")).toBe("Onaylı");
    expect(user.companies?.[0]?.role).toBe("OWNER");
    expect(companyContactRoleLabel("OWNER")).toBe("OWNER");
    expect(companyContactRoleLabel("ADMIN")).toBe("Yetkili");
  });

  it("escapes the user id on the object path", async () => {
    let url: string | null = null;
    server.use(
      http.get(apiUrl(`${MARKETPLACE_USERS_PATH}/*`), ({ request }) => {
        url = request.url;
        return HttpResponse.json({ success: false, message: "yok" }, { status: 404 });
      }),
    );

    await getMarketplaceUser("ACCESS-TOKEN", "../../me").catch(() => undefined);

    expect(url).toContain("%2F");
  });
});
