import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import { jobCategoriesSuccessBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";

import { getJobCategories } from "./reference";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getJobCategories", () => {
  it("calls the unauthenticated reference endpoint and returns typed categories", async () => {
    let authorization: string | null = "not-read";
    server.use(
      http.get(apiUrl("/reference/job-categories"), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(jobCategoriesSuccessBody);
      }),
    );

    const categories = await getJobCategories();

    expect(categories).toHaveLength(3);
    expect(categories[0]?.code).toBe("BARISTA");
    expect(categories[0]?.requiresInsurance).toBe(false);
    // The endpoint is `permitAll`; this slice has no token to send and does not
    // pretend to have one.
    expect(authorization).toBeNull();
  });

  it("rejects a category payload missing a field the panel depends on", async () => {
    // The client logs the failure; the assertion below is about the throw.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    server.use(
      http.get(apiUrl("/reference/job-categories"), () =>
        HttpResponse.json({
          ...jobCategoriesSuccessBody,
          // `code` is what icons and colours are keyed on; losing it silently
          // would mean a blank pin rather than a loud failure.
          data: [{ id: "9a1c0f10-0001-4c00-8000-000000000005", name: "Barista" }],
        }),
      ),
    );

    await expect(getJobCategories()).rejects.toThrow(/şemaya uymuyor/);
  });
});
