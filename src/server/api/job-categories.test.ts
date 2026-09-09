import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  createJobCategory,
  deleteJobCategory,
  getManagedJobCategories,
  JOB_CATEGORIES_PATH,
  updateJobCategory,
} from "./job-categories";

const CATEGORY_ID = "ca000000-0000-4000-8000-000000000001";

function category(overrides: Record<string, unknown> = {}) {
  return {
    id: CATEGORY_ID,
    code: "BARISTA",
    name: "Barista",
    requiresInsurance: true,
    ...overrides,
  };
}

function dataEnvelope(path: string, data: unknown, status = "200 OK") {
  return {
    success: true,
    message: "İşlem başarılı.",
    httpStatus: status,
    path,
    requestId: "rid-category",
    timeStamp: "2026-09-09T12:00:00.000000000Z",
    data,
  };
}

describe("the staff category contract", () => {
  it("lists the managed catalogue with the staff token", async () => {
    let authorization: string | null = null;

    server.use(
      http.get(apiUrl(JOB_CATEGORIES_PATH), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(dataEnvelope(JOB_CATEGORIES_PATH, [category()]));
      }),
    );

    const result = await getManagedJobCategories("STAFF-TOKEN");

    expect(authorization).toBe("Bearer STAFF-TOKEN");
    expect(result).toEqual([category()]);
  });

  it("creates a category with the backend's exact request body", async () => {
    let authorization: string | null = null;
    let body: unknown = null;

    server.use(
      http.post(apiUrl(JOB_CATEGORIES_PATH), async ({ request }) => {
        authorization = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json(dataEnvelope(JOB_CATEGORIES_PATH, category(), "201 CREATED"), {
          status: 201,
        });
      }),
    );

    const created = await createJobCategory("STAFF-TOKEN", {
      code: "BARISTA",
      name: "Barista",
      requiresInsurance: true,
    });

    expect(authorization).toBe("Bearer STAFF-TOKEN");
    expect(body).toEqual({ code: "BARISTA", name: "Barista", requiresInsurance: true });
    expect(created).toEqual(category());
  });

  it("updates the addressed category with PUT", async () => {
    let method = "";
    let body: unknown = null;

    server.use(
      http.put(apiUrl(`${JOB_CATEGORIES_PATH}/${CATEGORY_ID}`), async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json(
          dataEnvelope(
            `${JOB_CATEGORIES_PATH}/${CATEGORY_ID}`,
            category({ name: "Kıdemli Barista", requiresInsurance: false }),
          ),
        );
      }),
    );

    const updated = await updateJobCategory("STAFF-TOKEN", CATEGORY_ID, {
      code: "BARISTA",
      name: "Kıdemli Barista",
      requiresInsurance: false,
    });

    expect(method).toBe("PUT");
    expect(body).toEqual({
      code: "BARISTA",
      name: "Kıdemli Barista",
      requiresInsurance: false,
    });
    expect(updated.name).toBe("Kıdemli Barista");
  });

  it("deletes with no invented request body", async () => {
    let body = "not-seen";
    let contentType: string | null = "not-seen";

    server.use(
      http.delete(apiUrl(`${JOB_CATEGORIES_PATH}/${CATEGORY_ID}`), async ({ request }) => {
        body = await request.text();
        contentType = request.headers.get("content-type");
        return HttpResponse.json({
          success: true,
          message: "İş kategorisi silindi.",
          httpStatus: "200 OK",
          path: `${JOB_CATEGORIES_PATH}/${CATEGORY_ID}`,
          requestId: "rid-delete",
          timeStamp: "2026-09-09T12:00:00.000000000Z",
        });
      }),
    );

    const result = await deleteJobCategory("STAFF-TOKEN", CATEGORY_ID);

    expect(body).toBe("");
    expect(contentType).toBeNull();
    expect(result.requestId).toBe("rid-delete");
  });
});
