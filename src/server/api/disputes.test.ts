import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";

import {
  ACTIVE_DISPUTE_STATUSES,
  DISPUTES_PATH,
  DISPUTE_RESOLUTION_SPECS,
  disputeEvidencePath,
  disputeResolvePath,
  getDisputeEvidence,
  getDisputes,
  isDisputeResolution,
  resolveDispute,
} from "./disputes";
import { isKoalaApiError } from "./errors";

/**
 * `webAPI/DisputesController.java`, pinned.
 *
 * The two facts worth a test rather than a comment: omitting `status` keeps
 * the pending queue, a concrete status is forwarded, and the resolution enum
 * is closed (so an unknown value fails at the boundary instead of reaching a
 * screen that decides whether money moved).
 */

const DISPUTE_ID = "d1000000-0000-4c00-8000-000000000001";
const ASSIGNMENT_ID = "9a1c0f10-0001-4c00-8000-0000000000aa";

const DISPUTE = {
  id: DISPUTE_ID,
  jobAssignmentId: ASSIGNMENT_ID,
  openedBy: { id: "w-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
  status: "OPEN",
  reason: "İşveren işi eksik yaptığımı söylüyor.",
  resolution: null,
  resolutionNote: null,
  resolvedAt: null,
  createdAt: "2026-09-05T08:00:00.000000000Z",
};

function pageEnvelope(content: unknown[]) {
  return {
    success: true,
    message: "Uyuşmazlıklar listelendi.",
    httpStatus: "200 OK",
    path: DISPUTES_PATH,
    requestId: "rid-disputes",
    timeStamp: "2026-09-06T09:00:00.000000000Z",
    data: {
      content,
      page: 0,
      size: 25,
      totalElements: content.length,
      totalPages: 1,
      first: true,
      last: true,
    },
  };
}

describe("the queue endpoint", () => {
  it("asks for a page and omits status so the pending queue stays the default", async () => {
    let url: URL | null = null;

    server.use(
      http.get(apiUrl(DISPUTES_PATH), ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(pageEnvelope([DISPUTE]));
      }),
    );

    const page = await getDisputes("ACCESS-TOKEN", { size: 25 });

    expect(url).not.toBeNull();
    expect([...(url as unknown as URL).searchParams.keys()].sort()).toEqual(["page", "size"]);
    expect(page.content).toHaveLength(1);
    expect(page.content[0]?.status).toBe("OPEN");
    expect(page.content[0]?.openedBy?.firstName).toBe("Ayşe");
  });

  it("forwards a selected status so closed rows can be paged", async () => {
    let url: URL | null = null;

    server.use(
      http.get(apiUrl(DISPUTES_PATH), ({ request }) => {
        url = new URL(request.url);
        return HttpResponse.json(pageEnvelope([{ ...DISPUTE, status: "RESOLVED" }]));
      }),
    );

    await getDisputes("ACCESS-TOKEN", { status: "RESOLVED", page: 1, size: 25 });

    expect(url).not.toBeNull();
    expect((url as unknown as URL).searchParams.get("status")).toBe("RESOLVED");
    expect((url as unknown as URL).searchParams.get("page")).toBe("1");
  });

  it("mirrors DisputeManager.ACTIVE — the pending default when status is omitted", () => {
    expect([...ACTIVE_DISPUTE_STATUSES]).toEqual(["OPEN", "UNDER_REVIEW"]);
  });

  it("fails loudly on a status the panel has never heard of", async () => {
    server.use(
      http.get(apiUrl(DISPUTES_PATH), () =>
        HttpResponse.json(pageEnvelope([{ ...DISPUTE, status: "ESCALATED" }])),
      ),
    );

    const error = await getDisputes("ACCESS-TOKEN").catch((e: unknown) => e);

    expect(isKoalaApiError(error)).toBe(true);
    if (!isKoalaApiError(error)) throw new Error("unreachable");
    expect(error.errorCode).toBe("RESPONSE_SCHEMA_MISMATCH");
  });
});

describe("the evidence metadata endpoint", () => {
  it("loads the selected dispute's safe metadata without exposing a storage address", async () => {
    let authorization: string | null = null;
    const path = disputeEvidencePath(DISPUTE_ID);

    server.use(
      http.get(apiUrl(path), ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          message: "Kanıtlar listelendi.",
          httpStatus: "200 OK",
          path,
          requestId: "rid-evidence",
          timeStamp: "2026-09-06T09:00:00.000000000Z",
          data: [
            {
              id: "e1000000-0000-4c00-8000-000000000001",
              disputeId: DISPUTE_ID,
              uploadedBy: {
                id: "w-1",
                firstName: "Ayşe",
                lastName: "Yılmaz",
                username: "ayse",
              },
              uploaderSide: "WORKER",
              fileName: "vardiya kanıtı.png",
              contentType: "image/png",
              fileSize: 1536,
              checksumSha256: "a".repeat(64),
              createdAt: "2026-09-05T08:15:00.000000000Z",
              storageKey: "files/dispute-evidence/secret.png",
            },
          ],
        });
      }),
    );

    const evidence = await getDisputeEvidence("ACCESS-TOKEN", DISPUTE_ID);

    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(evidence).toEqual([
      {
        id: "e1000000-0000-4c00-8000-000000000001",
        disputeId: DISPUTE_ID,
        uploadedBy: {
          id: "w-1",
          firstName: "Ayşe",
          lastName: "Yılmaz",
          username: "ayse",
          profilePictureUrl: null,
        },
        uploaderSide: "WORKER",
        fileName: "vardiya kanıtı.png",
        contentType: "image/png",
        fileSize: 1536,
        checksumSha256: "a".repeat(64),
        createdAt: "2026-09-05T08:15:00.000000000Z",
      },
    ]);
  });
});

describe("the resolve endpoint", () => {
  it("posts resolution and note to /admin/disputes/{id}/resolve", async () => {
    let body: unknown = undefined;
    let authorization: string | null = null;

    server.use(
      http.post(apiUrl(disputeResolvePath(DISPUTE_ID)), async ({ request }) => {
        body = await request.json();
        authorization = request.headers.get("authorization");
        return HttpResponse.json({
          success: true,
          message: "Uyuşmazlık çözüldü.",
          httpStatus: "200 OK",
          path: disputeResolvePath(DISPUTE_ID),
          requestId: "rid-resolve",
          timeStamp: "2026-09-06T09:05:00.000000000Z",
          data: {
            ...DISPUTE,
            status: "RESOLVED",
            resolution: "RELEASE_TO_WORKER",
            resolutionNote: "İşçi işi yapmış, kanıt fotoğrafları tutarlı.",
            resolvedAt: "2026-09-06T09:05:00.000000000Z",
          },
        });
      }),
    );

    const resolved = await resolveDispute("ACCESS-TOKEN", DISPUTE_ID, {
      resolution: "RELEASE_TO_WORKER",
      note: "İşçi işi yapmış, kanıt fotoğrafları tutarlı.",
    });

    expect(authorization).toBe("Bearer ACCESS-TOKEN");
    expect(body).toEqual({
      resolution: "RELEASE_TO_WORKER",
      note: "İşçi işi yapmış, kanıt fotoğrafları tutarlı.",
    });
    expect(resolved.status).toBe("RESOLVED");
    expect(resolved.resolution).toBe("RELEASE_TO_WORKER");
  });

  it("escapes the id in the path", () => {
    expect(disputeResolvePath("a b")).toBe("/admin/disputes/a%20b/resolve");
  });
});

describe("the resolution catalogue", () => {
  it("knows which decisions move money and to whom", () => {
    expect(
      DISPUTE_RESOLUTION_SPECS.map((spec) => [
        spec.resolution,
        spec.beneficiary,
        spec.movesMoney,
        spec.financialPermission,
      ]),
    ).toEqual([
      ["RELEASE_TO_WORKER", "WORKER", true, "payout.release"],
      ["REFUND_EMPLOYER", "EMPLOYER", true, "payment.refund"],
      // The only one that leaves escrow untouched — and the only one this
      // screen can offer when the amount cannot be read from the server.
      ["DISMISSED", null, false, null],
    ]);
  });

  it("rejects free text where a resolution is expected", () => {
    expect(isDisputeResolution("RELEASE_TO_WORKER")).toBe(true);
    expect(isDisputeResolution("release_to_worker")).toBe(false);
    expect(isDisputeResolution(null)).toBe(false);
  });
});
