import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { getMarketplaceUser, MARKETPLACE_USERS_PATH } from "./marketplace-users";

const USER_ID = "aaaaaaaa-0000-4000-8000-000000000001";

describe("the marketplace user object GET", () => {
  it("loads GET /admin/users/{id} as SafeUser without e-mail", async () => {
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
            email: "private@koala.test",
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
    });
    expect(JSON.stringify(user)).not.toContain("private@koala.test");
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
