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

const { submitSettingUpdate } = await import("./actions");

const ADMIN_ME = apiUrl("/admin/me");
const COMMISSION = apiUrl("/admin/settings/commission.rate");

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

function updateForm(key = "commission.rate", value = "0.10") {
  const form = new FormData();
  form.set("key", key);
  form.set("value", value);
  return form;
}

describe("setting mutations re-authorize at their own server endpoint", () => {
  it("does not PUT when settings.manage is absent", async () => {
    stubMe(["category.manage"]);
    let mutations = 0;
    server.use(
      http.put(COMMISSION, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );

    const outcome = await submitSettingUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.message).toContain("Ayarları yönet");
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("writes the exact value and refreshes the list after success", async () => {
    stubMe(["settings.manage"]);
    let body: unknown = null;
    server.use(
      http.put(COMMISSION, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({
          success: true,
          message: "Ayar güncellendi.",
          httpStatus: "200 OK",
          path: "/admin/settings/commission.rate",
          requestId: "rid-update",
          timeStamp: "2026-09-11T08:00:00.000000000Z",
          data: {
            key: "commission.rate",
            value: "0.10",
            description: "İşveren ücretine eklenen hizmet bedeli oranı.",
            updatedAt: "2026-09-11T08:00:00Z",
          },
        });
      }),
    );

    const outcome = await submitSettingUpdate(IDLE_AUTHORIZATION_OUTCOME, updateForm());

    expect(body).toEqual({ value: "0.10" });
    expect(outcome.status).toBe("SUCCEEDED");
    expect(outcome.message).toContain("setting.update");
    expect(revalidatePath).toHaveBeenCalledWith("/settings");
  });
});

describe("setting form validation", () => {
  it("keeps an unknown key away from the backend", async () => {
    stubMe(["settings.manage"]);
    let mutations = 0;
    server.use(
      http.put(apiUrl("/admin/settings/rastgele.anahtar"), () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );

    const outcome = await submitSettingUpdate(
      IDLE_AUTHORIZATION_OUTCOME,
      updateForm("rastgele.anahtar", "1"),
    );

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("key");
    expect(outcome.message).toContain("tanımlı değil");
  });

  it("does not send a commission rate above one", async () => {
    stubMe(["settings.manage"]);
    let mutations = 0;
    server.use(
      http.put(COMMISSION, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );

    const outcome = await submitSettingUpdate(
      IDLE_AUTHORIZATION_OUTCOME,
      updateForm("commission.rate", "1.5"),
    );

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("value");
    expect(outcome.message).toContain("0 ile 1");
  });

  it("does not stringify an uploaded file into a setting value", async () => {
    stubMe(["settings.manage"]);
    let mutations = 0;
    server.use(
      http.put(COMMISSION, () => {
        mutations += 1;
        return HttpResponse.error();
      }),
    );
    const form = new FormData();
    form.set("key", "commission.rate");
    form.set("value", new Blob(["1"]), "value.txt");

    const outcome = await submitSettingUpdate(IDLE_AUTHORIZATION_OUTCOME, form);

    expect(mutations).toBe(0);
    expect(outcome.status).toBe("BLOCKED");
    expect(outcome.field).toBe("value");
  });
});

describe("setting backend refusals", () => {
  it("shows a 400 out-of-range rate in operator language", async () => {
    stubMe(["settings.manage"]);
    server.use(
      http.put(COMMISSION, () =>
        HttpResponse.json(
          {
            success: false,
            message: "Bu ayar 0 ile 1 arasında bir oran olmalıdır.",
            httpStatus: "400 BAD_REQUEST",
            errorCode: "SETTING_VALUE_OUT_OF_RANGE",
            errorCategory: "VALIDATION_FAILED",
            requestId: "rid-range",
            path: "/admin/settings/commission.rate",
            timeStamp: "2026-09-11T08:00:00.000000000Z",
          },
          { status: 400 },
        ),
      ),
    );

    const outcome = await submitSettingUpdate(
      IDLE_AUTHORIZATION_OUTCOME,
      updateForm("commission.rate", "0.20"),
    );

    expect(outcome.status).toBe("REFUSED");
    expect(outcome.errorCode).toBe("SETTING_VALUE_OUT_OF_RANGE");
    expect(outcome.requestId).toBe("rid-range");
    expect(outcome.message).toBe("Bu ayar 0 ile 1 arasında bir oran olmalıdır.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
