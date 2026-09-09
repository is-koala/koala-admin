import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { IDLE_AUTHORIZATION_OUTCOME } from "@/lib/authorization-change";
import { adminMeSuccessBody } from "../../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../../test/msw";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const revalidatePath = vi.fn();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => revalidatePath(path),
}));

const { submitCategoryCreate, submitCategoryDelete, submitCategoryUpdate } =
  await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const CATEGORIES = apiUrl("/admin/job-categories");
const CATEGORY_ID = "ca000000-0000-4000-8000-000000000001";

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  revalidatePath.mockReset();
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

function createForm() {
  const form = new FormData();
  form.set("code", "BARISTA");
  form.set("name", "Barista");
  form.set("requiresInsurance", "true");
  return form;
}

function updateForm() {
  const form = createForm();
  form.set("categoryId", CATEGORY_ID);
  form.set("name", "Kıdemli Barista");
  form.set("requiresInsurance", "false");
  return form;
}

function deleteForm(confirmed = true) {
  const form = new FormData();
  form.set("categoryId", CATEGORY_ID);
  if (confirmed) form.set("deleteConfirmation", `DELETE:${CATEGORY_ID}`);
  return form;
}

describe("category mutations re-authorize at their own server endpoint", () => {
  it("does not create when category.manage is absent", async () => {
    stubMe(["content.moderate"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("İş kategorilerini yönet");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not update or delete when category.manage is absent", async () => {
    stubMe(["content.moderate"]);
    let mutations = 0;
    server.use(
      http.put(`${CATEGORIES}/${CATEGORY_ID}`, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
      http.delete(`${CATEGORIES}/${CATEGORY_ID}`, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );

    const updateOutcome = await submitCategoryUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());
    const deleteOutcome = await submitCategoryDelete(IDLE_AUTHORIZATION_OUTCOME, deleteForm());

    expect(mutations).toBe(0);
    expect(updateOutcome.status).toBe("BLOCKED");
    expect(deleteOutcome.status).toBe("BLOCKED");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates the exact category and refreshes the catalogue after success", async () => {
    stubMe(["category.manage"]);
    let body: unknown = null;
    server.use(
      http.post(CATEGORIES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            success: true,
            message: "İş kategorisi oluşturuldu.",
            httpStatus: "201 CREATED",
            path: "/admin/job-categories",
            requestId: "rid-create",
            timeStamp: "2026-09-09T12:00:00.000000000Z",
            data: {
              id: CATEGORY_ID,
              code: "BARISTA",
              name: "Barista",
              requiresInsurance: true,
            },
          },
          { status: 201 },
        );
      }),
    );

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(body).toEqual({ code: "BARISTA", name: "Barista", requiresInsurance: true });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("job.category.create");
    expect(revalidatePath).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/job-categories");
  });

  it("does not report a committed create as refused when revalidation fails", async () => {
    stubMe(["category.manage"]);
    server.use(
      http.post(CATEGORIES, () =>
        HttpResponse.json(
          {
            success: true,
            message: "İş kategorisi oluşturuldu.",
            httpStatus: "201 CREATED",
            path: "/admin/job-categories",
            requestId: "rid-create",
            timeStamp: "2026-09-09T12:00:00.000000000Z",
            data: {
              id: CATEGORY_ID,
              code: "BARISTA",
              name: "Barista",
              requiresInsurance: true,
            },
          },
          { status: 201 },
        ),
      ),
    );
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("oluşturuldu");
    expect(outcome.message).toContain("sayfayı yenileyin");
  });
});

describe("category form validation", () => {
  it("keeps a malformed code away from the backend", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("code", "barista space");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("code");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not silently normalize a spaced code the backend contract rejects", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("code", " BARISTA ");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("code");
  });

  it("does not rewrite a nonblank name before sending the backend contract", async () => {
    stubMe(["category.manage"]);
    let body: unknown = null;
    server.use(
      http.post(CATEGORIES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(
          {
            success: true,
            message: "İş kategorisi oluşturuldu.",
            httpStatus: "201 CREATED",
            path: "/admin/job-categories",
            requestId: "rid-create",
            timeStamp: "2026-09-09T12:00:00.000000000Z",
            data: {
              id: CATEGORY_ID,
              code: "BARISTA",
              name: " Barista ",
              requiresInsurance: true,
            },
          },
          { status: 201 },
        );
      }),
    );
    const form = createForm();
    form.set("name", " Barista ");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(outcome.status).toBe("SUCCEEDED");
    expect(body).toEqual({ code: "BARISTA", name: " Barista ", requiresInsurance: true });
  });

  it("does not send a blank category name", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("name", "   ");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.field).toBe("name");
  });

  it("does not coerce an invalid insurance value to false", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("requiresInsurance", "perhaps");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("requiresInsurance");
  });

  it("does not default a missing required insurance flag to false", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.delete("requiresInsurance");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("requiresInsurance");
  });

  it("does not stringify an uploaded file into a category name", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(CATEGORIES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("name", new Blob(["not text"]), "category.txt");

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("name");
  });
});

describe("category backend refusals", () => {
  it("keeps duplicate-code ownership and requestId on the code field", async () => {
    stubMe(["category.manage"]);
    server.use(
      http.post(CATEGORIES, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu kategori kodu zaten kullanılıyor.",
            httpStatus: "409 CONFLICT",
            errorCode: "JOB_CATEGORY_CODE_ALREADY_EXISTS",
            errorCategory: "DATA_CONFLICT",
            requestId: "rid-duplicate",
            path: "/admin/job-categories",
            timeStamp: "2026-09-09T12:00:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const outcome = await submitCategoryCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.field).toBe("code");
    expect(outcome.errorCode).toBe("JOB_CATEGORY_CODE_ALREADY_EXISTS");
    expect(outcome.requestId).toBe("rid-duplicate");
    expect(outcome.message).toContain("zaten kullanılıyor");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("editing a category", () => {
  it("sends the full PUT contract and records the backend audit action", async () => {
    stubMe(["category.manage"]);
    let body: unknown = null;
    server.use(
      http.put(`${CATEGORIES}/${CATEGORY_ID}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "İş kategorisi güncellendi.",
          httpStatus: "200 OK",
          path: `/admin/job-categories/${CATEGORY_ID}`,
          requestId: "rid-update",
          timeStamp: "2026-09-09T12:00:00.000000000Z",
          data: {
            id: CATEGORY_ID,
            code: "BARISTA",
            name: "Kıdemli Barista",
            requiresInsurance: false,
          },
        });
      }),
    );

    const outcome = await submitCategoryUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());

    expect(body).toEqual({
      code: "BARISTA",
      name: "Kıdemli Barista",
      requiresInsurance: false,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("job.category.update");
    expect(revalidatePath).toHaveBeenCalledWith("/job-categories");
  });

  it("keeps a missing-category requestId and tells the operator to refresh", async () => {
    stubMe(["category.manage"]);
    server.use(
      http.put(`${CATEGORIES}/${CATEGORY_ID}`, () =>
        HttpResponse.json(
          {
            success: false,
            message: "İş kategorisi bulunamadı.",
            httpStatus: "404 NOT_FOUND",
            errorCode: "JOB_CATEGORY_NOT_FOUND_BY_ID",
            errorCategory: "DATA_NOT_FOUND",
            requestId: "rid-missing",
            path: `/admin/job-categories/${CATEGORY_ID}`,
            timeStamp: "2026-09-09T12:00:00.000000000Z",
          },
          { status: 404 },
        ),
      ),
    );

    const outcome = await submitCategoryUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.errorCode).toBe("JOB_CATEGORY_NOT_FOUND_BY_ID");
    expect(outcome.requestId).toBe("rid-missing");
    expect(outcome.message).toContain("sayfayı yenileyin");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("deleting a category", () => {
  it("does not call DELETE without the exact irreversible confirmation", async () => {
    stubMe(["category.manage"]);
    let deletes = 0;
    server.use(
      http.delete(`${CATEGORIES}/${CATEGORY_ID}`, () => {
        deletes += 1;
        return HttpResponse.error();
      }),
    );

    const outcome = await submitCategoryDelete(IDLE_AUTHORIZATION_OUTCOME, deleteForm(false));

    expect(deletes).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("deleteConfirmation");
    expect(outcome.message).toContain("geri alınamaz");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("deletes only the selected category and records the backend audit action", async () => {
    stubMe(["category.manage"]);
    let body: string | null = "not-called";
    server.use(
      http.delete(`${CATEGORIES}/${CATEGORY_ID}`, async ({ request }) => {
        body = await request.text();
        return HttpResponse.json({
          success: true,
          message: "İş kategorisi silindi.",
          httpStatus: "200 OK",
          path: `/admin/job-categories/${CATEGORY_ID}`,
          requestId: "rid-delete",
          timeStamp: "2026-09-09T12:00:00.000000000Z",
        });
      }),
    );

    const outcome = await submitCategoryDelete(IDLE_AUTHORIZATION_OUTCOME, deleteForm());

    expect(body).toBe("");
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("job.category.delete");
    expect(revalidatePath).toHaveBeenCalledWith("/job-categories");
  });

  it("explains the in-use conflict and preserves its requestId", async () => {
    stubMe(["category.manage"]);
    server.use(
      http.delete(`${CATEGORIES}/${CATEGORY_ID}`, () =>
        HttpResponse.json(
          {
            success: false,
            message: "İş kategorisi kullanımda.",
            httpStatus: "409 CONFLICT",
            errorCode: "JOB_CATEGORY_IN_USE",
            errorCategory: "DATA_CONFLICT",
            requestId: "rid-in-use",
            path: `/admin/job-categories/${CATEGORY_ID}`,
            timeStamp: "2026-09-09T12:00:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const outcome = await submitCategoryDelete(IDLE_AUTHORIZATION_OUTCOME, deleteForm());

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.errorCode).toBe("JOB_CATEGORY_IN_USE");
    expect(outcome.requestId).toBe("rid-in-use");
    expect(outcome.message).toContain("ilan, alarm veya şablon");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
