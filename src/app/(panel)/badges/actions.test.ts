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

const { submitBadgeActivation, submitBadgeCreate, submitBadgeIcon, submitBadgeUpdate } =
  await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const BADGES = apiUrl("/admin/badges");
const BADGE_ID = "ba000000-0000-4000-8000-000000000001";

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
  form.set("code", "GEZGIN_SILVER");
  form.set("family", "GEZGIN");
  form.set("tier", "SILVER");
  form.set("name", "Gezgin Gümüş");
  form.set("description", "5 tamamlanmış iş.");
  form.set("sortOrder", "10");
  form.set("ruleType", "COMPLETED_ASSIGNMENTS");
  form.set("minCount", "5");
  form.set("minAverageRating", "");
  form.set("minReviewCount", "");
  form.set("active", "true");
  return form;
}

function updateForm() {
  const form = createForm();
  form.set("badgeId", BADGE_ID);
  form.set("name", "Gezgin Gümüş+");
  return form;
}

function iconForm(
  file: File | null = new File([new Uint8Array([137])], "rozet.png", { type: "image/png" }),
) {
  const form = new FormData();
  form.set("badgeId", BADGE_ID);
  if (file !== null) form.set("icon", file);
  return form;
}

function activationForm(active: string) {
  const form = new FormData();
  form.set("badgeId", BADGE_ID);
  form.set("active", active);
  return form;
}

function createdEnvelope() {
  return {
    success: true,
    message: "Rozet oluşturuldu.",
    httpStatus: "201 CREATED",
    path: "/admin/badges",
    requestId: "rid-create",
    timeStamp: "2026-09-11T12:00:00.000000000Z",
    data: {
      id: BADGE_ID,
      code: "GEZGIN_SILVER",
      family: "GEZGIN",
      tier: "SILVER",
      name: "Gezgin Gümüş",
      description: "5 tamamlanmış iş.",
      iconUrl: null,
      sortOrder: 10,
      ruleType: "COMPLETED_ASSIGNMENTS",
      minCount: 5,
      minAverageRating: null,
      minReviewCount: null,
      active: true,
    },
  };
}

describe("badge mutations re-authorize at their own server endpoint", () => {
  it("does not create, update, upload, or toggle when badge.manage is absent", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.post(BADGES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
      http.put(`${BADGES}/${BADGE_ID}`, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
      http.put(`${BADGES}/${BADGE_ID}/icon`, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
      http.post(`${BADGES}/${BADGE_ID}/activation`, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );

    const createOutcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());
    const updateOutcome = await submitBadgeUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());
    const iconOutcome = await submitBadgeIcon(IDLE_AUTHORIZATION_OUTCOME, iconForm());
    const activeOutcome = await submitBadgeActivation(
      IDLE_AUTHORIZATION_OUTCOME,
      activationForm("false"),
    );

    expect(mutations).toBe(0);
    expect(createOutcome.status).toBe("BLOCKED");
    expect(updateOutcome.status).toBe("BLOCKED");
    expect(iconOutcome.status).toBe("BLOCKED");
    expect(activeOutcome.status).toBe("BLOCKED");
    expect(createOutcome.message).toContain("Rozetleri yönet");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("creates the exact badge and refreshes the catalogue after success", async () => {
    stubMe(["badge.manage"]);
    let body: unknown = null;
    server.use(
      http.post(BADGES, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json(createdEnvelope(), { status: 201 });
      }),
    );

    const outcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(body).toEqual({
      code: "GEZGIN_SILVER",
      family: "GEZGIN",
      tier: "SILVER",
      name: "Gezgin Gümüş",
      description: "5 tamamlanmış iş.",
      sortOrder: 10,
      ruleType: "COMPLETED_ASSIGNMENTS",
      minCount: 5,
      minAverageRating: null,
      minReviewCount: null,
      active: true,
    });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("badge.create");
    expect(revalidatePath).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/badges");
  });

  it("does not report a committed create as refused when revalidation fails", async () => {
    stubMe(["badge.manage"]);
    server.use(http.post(BADGES, () => HttpResponse.json(createdEnvelope(), { status: 201 })));
    revalidatePath.mockImplementationOnce(() => {
      throw new Error("cache unavailable");
    });

    const outcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("oluşturuldu");
    expect(outcome.message).toContain("sayfayı yenileyin");
  });
});

describe("badge form validation", () => {
  it("keeps a malformed code away from the backend", async () => {
    stubMe(["badge.manage"]);
    let mutations = 0;
    server.use(
      http.post(BADGES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("code", "gezgin space");

    const outcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("code");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("does not send a count rule without its threshold", async () => {
    stubMe(["badge.manage"]);
    let mutations = 0;
    server.use(
      http.post(BADGES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("minCount", "");

    const outcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("minCount");
  });

  it("does not stringify an uploaded file into a badge name", async () => {
    stubMe(["badge.manage"]);
    let mutations = 0;
    server.use(
      http.post(BADGES, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = createForm();
    form.set("name", new Blob(["not text"]), "badge.txt");

    const outcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("name");
  });
});

describe("editing a badge", () => {
  it("sends the full PUT contract and records the backend audit action", async () => {
    stubMe(["badge.manage"]);
    let body: unknown = null;
    server.use(
      http.put(`${BADGES}/${BADGE_ID}`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          ...createdEnvelope(),
          message: "Rozet güncellendi.",
          httpStatus: "200 OK",
          path: `/admin/badges/${BADGE_ID}`,
          data: { ...createdEnvelope().data, name: "Gezgin Gümüş+" },
        });
      }),
    );

    const outcome = await submitBadgeUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());

    expect(body).toMatchObject({ code: "GEZGIN_SILVER", name: "Gezgin Gümüş+" });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("badge.update");
    expect(revalidatePath).toHaveBeenCalledWith("/badges");
  });

  it("keeps duplicate-code ownership and requestId on the code field", async () => {
    stubMe(["badge.manage"]);
    server.use(
      http.post(BADGES, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu rozet kodu zaten kullanılıyor.",
            httpStatus: "409 CONFLICT",
            errorCode: "BADGE_CODE_ALREADY_EXISTS",
            errorCategory: "DATA_CONFLICT",
            requestId: "rid-duplicate",
            path: "/admin/badges",
            timeStamp: "2026-09-11T12:00:00.000000000Z",
          },
          { status: 409 },
        ),
      ),
    );

    const outcome = await submitBadgeCreate(IDLE_AUTHORIZATION_OUTCOME, createForm());

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.field).toBe("code");
    expect(outcome.errorCode).toBe("BADGE_CODE_ALREADY_EXISTS");
    expect(outcome.requestId).toBe("rid-duplicate");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("icon and activation", () => {
  it("does not PUT an icon when the part is missing", async () => {
    stubMe(["badge.manage"]);
    let uploads = 0;
    server.use(
      http.put(`${BADGES}/${BADGE_ID}/icon`, () => {
        uploads += 1;
        return HttpResponse.error();
      }),
    );

    const outcome = await submitBadgeIcon(IDLE_AUTHORIZATION_OUTCOME, iconForm(null));

    expect(uploads).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("icon");
  });

  it("uploads the selected file as the icon part", async () => {
    stubMe(["badge.manage"]);
    let fileName: string | null = null;
    server.use(
      http.put(`${BADGES}/${BADGE_ID}/icon`, async ({ request }) => {
        const incoming = await request.formData();
        const icon = incoming.get("icon");
        fileName = icon instanceof File ? icon.name : null;
        return HttpResponse.json({
          ...createdEnvelope(),
          message: "Rozet görseli güncellendi.",
          httpStatus: "200 OK",
          path: `/admin/badges/${BADGE_ID}/icon`,
          data: { ...createdEnvelope().data, iconUrl: "https://cdn.example/rozet.png" },
        });
      }),
    );

    const outcome = await submitBadgeIcon(IDLE_AUTHORIZATION_OUTCOME, iconForm());

    expect(fileName).toBe("rozet.png");
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("badge.icon.set");
    expect(revalidatePath).toHaveBeenCalledWith("/badges");
  });

  it("posts activation as a query flag with no JSON body", async () => {
    stubMe(["badge.manage"]);
    let url = "";
    let body = "not-seen";
    server.use(
      http.post(`${BADGES}/${BADGE_ID}/activation`, async ({ request }) => {
        url = request.url;
        body = await request.text();
        return HttpResponse.json({
          ...createdEnvelope(),
          message: "Rozet durumu güncellendi.",
          httpStatus: "200 OK",
          path: `/admin/badges/${BADGE_ID}/activation`,
          data: { ...createdEnvelope().data, active: false },
        });
      }),
    );

    const outcome = await submitBadgeActivation(
      IDLE_AUTHORIZATION_OUTCOME,
      activationForm("false"),
    );

    expect(url).toContain("active=false");
    expect(body).toBe("");
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("badge.activation.set");
  });
});
