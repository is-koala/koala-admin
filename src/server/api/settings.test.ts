import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import { getRuntimeSettings, SETTINGS_PATH, updateRuntimeSetting } from "./settings";

function setting(overrides: Record<string, unknown> = {}) {
  return {
    key: "commission.rate",
    value: "0.10",
    description: "İşveren ücretine eklenen hizmet bedeli oranı.",
    updatedAt: "2026-09-11T08:00:00Z",
    ...overrides,
  };
}

function dataEnvelope(path: string, data: unknown) {
  return {
    success: true,
    message: "İşlem başarılı.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-settings",
    timeStamp: "2026-09-11T08:00:00.000000000Z",
    data,
  };
}

describe("the staff settings contract", () => {
  it("lists settings with the staff token", async () => {
    let authorization: string | null = null;

    server.use(
      http.get(apiUrl(SETTINGS_PATH), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(dataEnvelope(SETTINGS_PATH, [setting()]));
      }),
    );

    const result = await getRuntimeSettings("STAFF-TOKEN");

    expect(authorization).toBe("Bearer STAFF-TOKEN");
    expect(result).toEqual([setting()]);
  });

  it("puts only the value onto the addressed key", async () => {
    let authorization: string | null = null;
    let body: unknown = null;
    let path: string | null = null;

    server.use(
      http.put(apiUrl(`${SETTINGS_PATH}/commission.rate`), async ({ request }) => {
        authorization = request.headers.get("authorization");
        body = await request.json();
        path = new URL(request.url).pathname;
        return HttpResponse.json(
          dataEnvelope(`${SETTINGS_PATH}/commission.rate`, setting({ value: "0.12" })),
        );
      }),
    );

    const updated = await updateRuntimeSetting("STAFF-TOKEN", "commission.rate", "0.12");

    expect(authorization).toBe("Bearer STAFF-TOKEN");
    expect(path).toBe("/admin/settings/commission.rate");
    expect(body).toEqual({ value: "0.12" });
    expect(updated.value).toBe("0.12");
  });
});
