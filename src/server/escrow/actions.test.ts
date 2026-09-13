import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { INITIAL_ESCROW_FORM_STATE } from "@/lib/escrow-form";

import { adminMeSuccessBody } from "../../../test/fixtures/envelopes";
import { adminAssignmentFixture } from "../../../test/fixtures/admin-assignment";
import { apiUrl, server } from "../../../test/msw";

const getKoalaAccessToken = vi.fn<() => Promise<string>>();
const revalidatePath = vi.fn<(path: string) => void>();

vi.mock("@/server/auth/session", () => ({
  getKoalaAccessToken: () => getKoalaAccessToken(),
  backendSaysPasswordMustChange: () => Promise.resolve(false),
}));

vi.mock("next/cache", () => ({ revalidatePath }));

const { submitEscrowOperation } = await import("./actions");
const { clearEscrowSubmissions } = await import("./operations");
const { clearRecentOperations, recentOperations } = await import("./recent-operations");

const ASSIGNMENT = "9a1c0f10-0001-4c00-8000-0000000000aa";
const DISPUTE = "d1000000-0000-4c00-8000-000000000001";

const ADMIN_ME = apiUrl("/admin/me");
const SUMMARY = apiUrl(`/admin/job-assignments/${ASSIGNMENT}`);
const REFUND = apiUrl(`/admin/job-assignments/${ASSIGNMENT}/refund`);
const RESOLVE = apiUrl(`/admin/disputes/${DISPUTE}/resolve`);

const SUMMARY_BODY = adminAssignmentFixture({ id: ASSIGNMENT, jobId: "job-1" });

function envelope(path: string, data: unknown) {
  return {
    success: true,
    message: "İşlem tamam.",
    httpStatus: "200 OK",
    path,
    requestId: "rid-action",
    timeStamp: "2026-09-06T10:00:00Z",
    data,
  };
}

function stubMe(permissions: readonly string[]): void {
  server.use(
    http.get(ADMIN_ME, () =>
      HttpResponse.json({
        ...adminMeSuccessBody,
        data: { ...adminMeSuccessBody.data, permissions: [...permissions] },
      }),
    ),
  );
}

function watch(method: "get" | "post", url: string, response: () => Response) {
  const seen: { calls: number; body: unknown } = { calls: 0, body: null };
  server.use(
    http[method](url, async ({ request }) => {
      seen.calls += 1;
      seen.body = method === "post" ? await request.json() : null;
      return response();
    }),
  );
  return seen;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.append(name, value);
  return data;
}

function submit(fields: Record<string, string>) {
  return submitEscrowOperation(INITIAL_ESCROW_FORM_STATE, form(fields));
}

beforeEach(() => {
  getKoalaAccessToken.mockResolvedValue("ACCESS-TOKEN");
  revalidatePath.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  clearEscrowSubmissions();
  clearRecentOperations();
});

afterEach(() => {
  vi.restoreAllMocks();
  getKoalaAccessToken.mockReset();
  revalidatePath.mockReset();
});

describe("the escrow Server Action boundary", () => {
  it("carries an exact 512-character refund reason through transport and the transient panel record", async () => {
    const reason = "ğ".repeat(512);
    stubMe(["payment.read", "payment.refund"]);
    watch("get", SUMMARY, () =>
      HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, SUMMARY_BODY)),
    );
    const refund = watch("post", REFUND, () =>
      HttpResponse.json({
        success: true,
        message: "İade kaydı oluşturuldu.",
        httpStatus: "200 OK",
        requestId: "rid-refund",
      }),
    );

    const state = await submit({
      operationKey: "refund-512",
      kind: "REFUND",
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: "",
      reason,
      confirmedAmount: "1378.33",
    });

    expect(state.status).toBe("SUCCEEDED");
    // Backend audit transport proof: the reason crossed the request boundary unchanged.
    expect(refund.body).toEqual({ reason });
    // Separate, process-local UI history; not the durable backend audit log.
    expect(recentOperations()[0]?.reason).toBe(reason);
  });

  it("sends zero requests when a 513-character refund reason bypasses the form", async () => {
    stubMe(["payment.read", "payment.refund"]);
    const summary = watch("get", SUMMARY, () =>
      HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, SUMMARY_BODY)),
    );
    const refund = watch("post", REFUND, () => HttpResponse.json({ success: true }));

    const state = await submit({
      operationKey: "refund-513",
      kind: "REFUND",
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: "",
      reason: "x".repeat(513),
      confirmedAmount: "1378.33",
    });

    expect(state.status).toBe("BLOCKED");
    expect(state.message).toContain("en fazla 512 karakter");
    expect(summary.calls).toBe(0);
    expect(refund.calls).toBe(0);
  });

  it("sends zero requests for a release resolution without payout.release", async () => {
    stubMe(["dispute.resolve", "payment.read"]);
    const summary = watch("get", SUMMARY, () =>
      HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, SUMMARY_BODY)),
    );
    const resolve = watch("post", RESOLVE, () => HttpResponse.json({ success: true }));

    const state = await submit({
      operationKey: "unauthorised-resolution",
      kind: "RESOLVE_DISPUTE",
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: "RELEASE_TO_WORKER",
      reason: "Kanıtlar işçinin teslimatını doğruluyor.",
      confirmedAmount: "1240.50",
    });

    expect(state.status).toBe("BLOCKED");
    expect(state.message).toContain("payout.release");
    expect(summary.calls).toBe(0);
    expect(resolve.calls).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("sends zero requests for a financial resolution without payment.read", async () => {
    stubMe(["dispute.resolve", "payout.release"]);
    const summary = watch("get", SUMMARY, () =>
      HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, SUMMARY_BODY)),
    );
    const resolve = watch("post", RESOLVE, () => HttpResponse.json({ success: true }));

    const state = await submit({
      operationKey: "unreadable-resolution",
      kind: "RESOLVE_DISPUTE",
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: "RELEASE_TO_WORKER",
      reason: "Kanıtlar işçinin teslimatını doğruluyor.",
      confirmedAmount: "1240.50",
    });

    expect(state.status).toBe("BLOCKED");
    expect(state.message).toContain("payment.read");
    expect(summary.calls).toBe(0);
    expect(resolve.calls).toBe(0);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("revalidates the dispute, the queue and home after a successful resolution", async () => {
    stubMe(["dispute.resolve", "payment.read", "payout.release"]);
    watch("get", SUMMARY, () =>
      HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, SUMMARY_BODY)),
    );
    const resolve = watch("post", RESOLVE, () =>
      HttpResponse.json(
        envelope(`/admin/disputes/${DISPUTE}/resolve`, {
          id: DISPUTE,
          jobAssignmentId: ASSIGNMENT,
          openedBy: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
          status: "RESOLVED",
          reason: "İtiraz",
          resolution: "RELEASE_TO_WORKER",
          resolutionNote: "Kanıtlar işçinin teslimatını doğruluyor.",
          resolvedAt: "2026-09-06T10:00:00.000000000Z",
          createdAt: "2026-09-05T08:00:00.000000000Z",
        }),
      ),
    );

    const state = await submit({
      operationKey: "resolve-ok",
      kind: "RESOLVE_DISPUTE",
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: "RELEASE_TO_WORKER",
      reason: "Kanıtlar işçinin teslimatını doğruluyor.",
      confirmedAmount: "1240.50",
    });

    expect(state.status).toBe("SUCCEEDED");
    expect(resolve.calls).toBe(1);
    expect(revalidatePath.mock.calls.map(([path]) => path)).toEqual([
      `/disputes/${DISPUTE}`,
      "/disputes",
      "/",
    ]);
  });

  it("collapses a second submit of the same operation key without another mutation", async () => {
    stubMe(["dispute.resolve", "payment.read", "payout.release"]);
    watch("get", SUMMARY, () =>
      HttpResponse.json(envelope(`/admin/job-assignments/${ASSIGNMENT}`, SUMMARY_BODY)),
    );
    const resolve = watch("post", RESOLVE, () =>
      HttpResponse.json(
        envelope(`/admin/disputes/${DISPUTE}/resolve`, {
          id: DISPUTE,
          jobAssignmentId: ASSIGNMENT,
          openedBy: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
          status: "RESOLVED",
          reason: "İtiraz",
          resolution: "RELEASE_TO_WORKER",
          resolutionNote: "Kanıtlar işçinin teslimatını doğruluyor.",
          resolvedAt: "2026-09-06T10:00:00.000000000Z",
          createdAt: "2026-09-05T08:00:00.000000000Z",
        }),
      ),
    );

    const fields = {
      operationKey: "resolve-once",
      kind: "RESOLVE_DISPUTE",
      assignmentId: ASSIGNMENT,
      disputeId: DISPUTE,
      resolution: "RELEASE_TO_WORKER",
      reason: "Kanıtlar işçinin teslimatını doğruluyor.",
      confirmedAmount: "1240.50",
    };

    const first = await submit(fields);
    const second = await submit(fields);

    expect(first.status).toBe("SUCCEEDED");
    expect(second.status).toBe("SUCCEEDED");
    expect(second.deduplicated).toBe(true);
    expect(resolve.calls).toBe(1);
  });
});
