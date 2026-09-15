import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { JOB_ID, envelope } from "../../../test/fixtures/admin-detail";
import { resourceNotFoundBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { isKoalaApiError } from "./errors";
import { getAdminTransportPlan, transportPlanPath } from "./transport";

describe("getAdminTransportPlan", () => {
  it("returns the employer-shaped plan for staff", async () => {
    server.use(
      http.get(apiUrl(transportPlanPath(JOB_ID)), () =>
        HttpResponse.json(
          envelope(transportPlanPath(JOB_ID), {
            id: "tp-1",
            jobId: JOB_ID,
            outboundMethod: "SHUTTLE",
            returnMethod: "NONE",
            shuttles: [
              {
                id: "sh-1",
                direction: "OUTBOUND",
                name: "Anadolu servisi",
                plate: "34 ABC 12",
                capacity: 8,
                seatsTaken: 1,
                stops: [],
              },
            ],
          }),
        ),
      ),
    );

    const plan = await getAdminTransportPlan("TOKEN", JOB_ID);

    expect(plan?.shuttles[0]?.plate).toBe("34 ABC 12");
    expect(plan?.outboundMethod).toBe("SHUTTLE");
  });

  it("returns null when the job exists but has no plan", async () => {
    server.use(
      http.get(apiUrl(transportPlanPath(JOB_ID)), () =>
        HttpResponse.json(
          {
            ...resourceNotFoundBody,
            errorCode: "TRANSPORT_PLAN_NOT_FOUND",
            path: transportPlanPath(JOB_ID),
          },
          { status: 404 },
        ),
      ),
    );

    await expect(getAdminTransportPlan("TOKEN", JOB_ID)).resolves.toBeNull();
  });

  it("rethrows a missing job so the page can 404", async () => {
    server.use(
      http.get(apiUrl(transportPlanPath(JOB_ID)), () =>
        HttpResponse.json(
          { ...resourceNotFoundBody, errorCode: "JOB_NOT_FOUND", path: transportPlanPath(JOB_ID) },
          { status: 404 },
        ),
      ),
    );

    try {
      await getAdminTransportPlan("TOKEN", JOB_ID);
      throw new Error("expected failure");
    } catch (error) {
      expect(isKoalaApiError(error)).toBe(true);
      if (isKoalaApiError(error)) {
        expect(error.errorCode).toBe("JOB_NOT_FOUND");
        expect(error.isResourceNotFound).toBe(true);
      }
    }
  });
});
