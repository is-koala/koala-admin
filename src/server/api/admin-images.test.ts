import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiUrl, server } from "../../../test/msw";
import { isKoalaApiError } from "./errors";

import { adminImagePath, removeAdminImage } from "./admin-images";

const IMAGE_ID = "cccccccc-0000-4000-8000-000000000003";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("adminImagePath", () => {
  it("keeps a slash in the id from becoming a second path segment", () => {
    expect(adminImagePath("a/b")).toBe("/admin/images/a%2Fb");
  });
});

describe("removeAdminImage", () => {
  it("DELETEs /admin/images/{id} with the staff token and no invented body", async () => {
    let authorization: string | null = null;
    let method: string | null = null;

    server.use(
      http.delete(apiUrl(`/admin/images/${IMAGE_ID}`), ({ request }) => {
        authorization = request.headers.get("authorization");
        method = request.method;
        return HttpResponse.json({
          success: true,
          message: "Görsel kaldırıldı.",
          httpStatus: "200 OK",
          path: `/admin/images/${IMAGE_ID}`,
          requestId: "rid-img",
          timeStamp: "2026-09-11T20:00:00.000000000Z",
        });
      }),
    );

    await removeAdminImage("ACCESS-TOKEN", IMAGE_ID);

    expect(method).toBe("DELETE");
    expect(authorization).toBe("Bearer ACCESS-TOKEN");
  });

  it("surfaces a 404 as the backend's not-found, not as a panel invention", async () => {
    server.use(
      http.delete(apiUrl(`/admin/images/${IMAGE_ID}`), () =>
        HttpResponse.json(
          {
            success: false,
            message: "Görsel bulunamadı.",
            httpStatus: "404 NOT_FOUND",
            errorCode: "IMAGE_NOT_FOUND",
            errorCategory: "NOT_FOUND",
            requestId: "rid-404",
            path: `/admin/images/${IMAGE_ID}`,
            timeStamp: "2026-09-11T20:00:00.000000000Z",
          },
          { status: 404 },
        ),
      ),
    );

    const error = await removeAdminImage("ACCESS-TOKEN", IMAGE_ID).catch((e: unknown) => e);

    expect(isKoalaApiError(error)).toBe(true);
    if (!isKoalaApiError(error)) throw new Error("unreachable");
    expect(error.status).toBe(404);
    expect(error.errorCode).toBe("IMAGE_NOT_FOUND");
    expect(error.requestId).toBe("rid-404");
  });
});
