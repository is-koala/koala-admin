import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  BADGES_PATH,
  createBadge,
  getManagedBadges,
  setBadgeActive,
  setBadgeIcon,
  updateBadge,
} from "./badges";

const BADGE_ID = "ba000000-0000-4000-8000-000000000001";

function badge(overrides: Record<string, unknown> = {}) {
  return {
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
    ...overrides,
  };
}

function dataEnvelope(path: string, data: unknown, status = "200 OK") {
  return {
    success: true,
    message: "İşlem başarılı.",
    httpStatus: status,
    path,
    requestId: "rid-badge",
    timeStamp: "2026-09-11T12:00:00.000000000Z",
    data,
  };
}

const createInput = {
  code: "GEZGIN_SILVER",
  family: "GEZGIN" as const,
  tier: "SILVER" as const,
  name: "Gezgin Gümüş",
  description: "5 tamamlanmış iş.",
  sortOrder: 10,
  ruleType: "COMPLETED_ASSIGNMENTS" as const,
  minCount: 5,
  minAverageRating: null,
  minReviewCount: null,
  active: true,
};

describe("the staff badge contract", () => {
  it("lists every catalogue row, including inactive ones, with the staff token", async () => {
    let authorization: string | null = null;

    server.use(
      http.get(apiUrl(BADGES_PATH), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(dataEnvelope(BADGES_PATH, [badge({ active: false })]));
      }),
    );

    const result = await getManagedBadges("STAFF-TOKEN");

    expect(authorization).toBe("Bearer STAFF-TOKEN");
    expect(result).toEqual([badge({ active: false })]);
  });

  it("creates a badge with the backend's exact request body", async () => {
    let authorization: string | null = null;
    let body: unknown = null;

    server.use(
      http.post(apiUrl(BADGES_PATH), async ({ request }) => {
        authorization = request.headers.get("authorization");
        body = await request.json();
        return HttpResponse.json(dataEnvelope(BADGES_PATH, badge(), "201 CREATED"), {
          status: 201,
        });
      }),
    );

    const created = await createBadge("STAFF-TOKEN", createInput);

    expect(authorization).toBe("Bearer STAFF-TOKEN");
    expect(body).toEqual(createInput);
    expect(created).toEqual(badge());
  });

  it("updates the addressed badge with PUT and keeps unused thresholds null", async () => {
    let method = "";
    let body: unknown = null;
    const input = {
      ...createInput,
      name: "Gezgin Gümüş+",
      ruleType: "IDENTITY_VERIFIED" as const,
      minCount: null,
      minAverageRating: null,
      minReviewCount: null,
    };

    server.use(
      http.put(apiUrl(`${BADGES_PATH}/${BADGE_ID}`), async ({ request }) => {
        method = request.method;
        body = await request.json();
        return HttpResponse.json(
          dataEnvelope(
            `${BADGES_PATH}/${BADGE_ID}`,
            badge({ name: "Gezgin Gümüş+", ruleType: "IDENTITY_VERIFIED", minCount: null }),
          ),
        );
      }),
    );

    const updated = await updateBadge("STAFF-TOKEN", BADGE_ID, input);

    expect(method).toBe("PUT");
    expect(body).toEqual(input);
    expect(updated.name).toBe("Gezgin Gümüş+");
    expect(updated.minCount).toBeNull();
  });

  it("uploads the icon as the multipart part the backend names icon", async () => {
    let contentType: string | null = null;
    let partName: string | null = null;
    let fileName: string | null = null;

    server.use(
      http.put(apiUrl(`${BADGES_PATH}/${BADGE_ID}/icon`), async ({ request }) => {
        contentType = request.headers.get("content-type");
        const incoming = await request.formData();
        const icon = incoming.get("icon");
        partName = incoming.has("icon") ? "icon" : null;
        fileName = icon instanceof File ? icon.name : null;
        return HttpResponse.json(
          dataEnvelope(
            `${BADGES_PATH}/${BADGE_ID}/icon`,
            badge({ iconUrl: "https://cdn.example/rozet.png" }),
          ),
        );
      }),
    );

    const updated = await setBadgeIcon(
      "STAFF-TOKEN",
      BADGE_ID,
      new File([new Uint8Array([137, 80, 78])], "rozet.png", { type: "image/png" }),
    );

    expect(contentType).toMatch(/multipart\/form-data/i);
    expect(partName).toBe("icon");
    expect(fileName).toBe("rozet.png");
    expect(updated.iconUrl).toBe("https://cdn.example/rozet.png");
  });

  it("sets activation with the query flag and no invented JSON body", async () => {
    let url = "";
    let body = "not-seen";
    let contentType: string | null = "not-seen";

    server.use(
      http.post(apiUrl(`${BADGES_PATH}/${BADGE_ID}/activation`), async ({ request }) => {
        url = request.url;
        body = await request.text();
        contentType = request.headers.get("content-type");
        return HttpResponse.json(
          dataEnvelope(`${BADGES_PATH}/${BADGE_ID}/activation`, badge({ active: false })),
        );
      }),
    );

    const updated = await setBadgeActive("STAFF-TOKEN", BADGE_ID, false);

    expect(url).toContain("active=false");
    expect(body).toBe("");
    expect(contentType).toBeNull();
    expect(updated.active).toBe(false);
  });
});
