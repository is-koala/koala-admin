import { HttpResponse, http } from "msw";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  auditPageBody,
  categoryCreatedEntry,
  erasedDetailEntry,
  refusedEntry,
} from "../../../test/fixtures/audit-log";
import { apiUrl, server } from "../../../test/msw";
import { parseAuditLogRequest, type SearchParamsInput } from "@/lib/audit-log";

import { AUDIT_LOG_PATH, getAuditLog } from "./audit";

/**
 * The audit fetcher against koala-backend#15's contract, stubbed with MSW.
 *
 * The first block is the one koala-admin#10 asks for by name: every filter has
 * to become a query parameter on the outgoing request. The issue is specific
 * about why — the same mistake has already been made in-house, where the mobile
 * app fetches `GET /jobs` with no arguments and filters the twenty rows it got
 * back on the device. In an audit log that does not make the screen slow, it
 * makes it lie: you filter for March, you are handed the newest page, you find
 * nothing, and you conclude nothing happened.
 */

const AUDIT_LOG = apiUrl(AUDIT_LOG_PATH);

afterEach(() => {
  vi.restoreAllMocks();
});

/** Captures the URL the client actually requested. */
function captureRequest(body: object = auditPageBody()) {
  const seen: { url: URL | null; count: number } = { url: null, count: 0 };

  server.use(
    http.get(AUDIT_LOG, ({ request }) => {
      seen.url = new URL(request.url);
      seen.count += 1;
      return HttpResponse.json(body);
    }),
  );

  return seen;
}

const fetchWith = (params: SearchParamsInput) =>
  getAuditLog("ACCESS-TOKEN", parseAuditLogRequest(params));

describe("filters go to the server, one query parameter each", () => {
  it("puts every filter on the outgoing request", async () => {
    const seen = captureRequest();

    await fetchWith({
      actor: "Katalog Editörü",
      action: "job.category.create",
      permission: "category.manage",
      resourceType: "job-category",
      resourceId: "9a1c0f10-0001-4c00-8000-000000000009",
      allowed: "false",
      from: "2026-09-01",
      to: "2026-09-06",
      page: "2",
    });

    const query = seen.url?.searchParams;
    expect(query?.get("actor")).toBe("Katalog Editörü");
    expect(query?.get("action")).toBe("job.category.create");
    expect(query?.get("permission")).toBe("category.manage");
    expect(query?.get("resourceType")).toBe("job-category");
    expect(query?.get("resourceId")).toBe("9a1c0f10-0001-4c00-8000-000000000009");
    expect(query?.get("allowed")).toBe("false");
    // The date range, as the instants that day covers in Europe/Istanbul.
    expect(query?.get("from")).toBe("2026-08-31T21:00:00.000Z");
    expect(query?.get("to")).toBe("2026-09-06T20:59:59.999Z");
    expect(query?.get("page")).toBe("2");
    expect(query?.get("size")).toBe("25");
  });

  it("sends no filter parameter at all when nothing is filtered", async () => {
    const seen = captureRequest();

    await fetchWith({});

    // Not `actor=null`, not `actor=`: absent. A backend that treated the empty
    // string as a filter would return nothing and look like an empty log.
    expect([...(seen.url?.searchParams.keys() ?? [])].sort()).toEqual(["page", "size"]);
  });

  it("asks for exactly one page and sends the token with it", async () => {
    let authorization: string | null = null;
    server.use(
      http.get(AUDIT_LOG, ({ request }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json(auditPageBody({ content: [categoryCreatedEntry] }));
      }),
    );

    await fetchWith({});

    expect(authorization).toBe("Bearer ACCESS-TOKEN");
  });

  it("hands back the page the server sent, unchanged and unfiltered", async () => {
    // The negative half of the rule: nothing between the response and the
    // caller narrows `content`. Both rows come back even though they disagree
    // on `allowed`, which any client-side filter would have opinions about.
    captureRequest(auditPageBody({ content: [categoryCreatedEntry, refusedEntry] }));

    const page = await fetchWith({ allowed: "true" });

    expect(page.content.map((entry) => entry.id)).toEqual([
      categoryCreatedEntry.id,
      refusedEntry.id,
    ]);
  });
});

describe("paging", () => {
  it("passes the page through and returns the envelope's own paging fields", async () => {
    const seen = captureRequest(
      auditPageBody({
        content: [categoryCreatedEntry],
        page: 3,
        totalElements: 87,
        totalPages: 4,
      }),
    );

    const page = await fetchWith({ page: "3" });

    expect(seen.url?.searchParams.get("page")).toBe("3");
    expect(page.page).toBe(3);
    expect(page.totalElements).toBe(87);
    expect(page.totalPages).toBe(4);
    expect(page.first).toBe(false);
    expect(page.last).toBe(true);
  });
});

describe("the two halves of an audit record", () => {
  it("accepts a row whose detail has been erased, as a valid row", async () => {
    // The point of the whole schema: a null detail is koala-backend#15's design
    // working, not a contract violation. Rejecting it here would blank the page
    // for every row older than six months.
    captureRequest(auditPageBody({ content: [erasedDetailEntry] }));

    const page = await fetchWith({});
    const entry = page.content[0];

    expect(entry?.id).toBe(erasedDetailEntry.id);
    expect(entry?.actorDisplayName).toBe("Finans Sorumlusu");
    expect(entry?.sensitivity).toBe("FINANCIAL");
    expect(entry?.requestBody).toBeNull();
    expect(entry?.ip).toBeNull();
    expect(entry?.userAgent).toBeNull();
    expect(entry?.before).toBeNull();
    expect(entry?.after).toBeNull();
  });

  it("normalises a JSON snapshot to text whether it arrives parsed or as a string", async () => {
    captureRequest(
      auditPageBody({
        content: [
          categoryCreatedEntry,
          { ...refusedEntry, requestBody: '{"raw":"already a string"}' },
        ],
      }),
    );

    const page = await fetchWith({});

    expect(page.content[0]?.requestBody).toContain('"code": "COURIER"');
    expect(page.content[1]?.requestBody).toBe('{"raw":"already a string"}');
  });

  it("rejects a row that has lost a core field", async () => {
    // The other side of the same rule. A row that cannot say who acted is not a
    // weaker audit record; it is not one, and it must fail loudly at the
    // boundary rather than render as `undefined` three components down.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { actorStaffId: _dropped, ...withoutActor } = categoryCreatedEntry;
    captureRequest(auditPageBody({ content: [withoutActor as typeof categoryCreatedEntry] }));

    await expect(fetchWith({})).rejects.toThrow(/şemaya uymuyor/);
  });

  it("rejects a sensitivity the panel has no badge for", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    captureRequest(
      auditPageBody({
        content: [{ ...categoryCreatedEntry, sensitivity: "SECRET" as "NORMAL" }],
      }),
    );

    await expect(fetchWith({})).rejects.toThrow(/şemaya uymuyor/);
  });

  it("keeps an unknown permission name rather than dropping the row", async () => {
    // The opposite call from `sensitivity`, and deliberately so: the backend
    // owns the permission catalogue and may add to it between deploys. Blanking
    // the table over a name this build has not heard of would lose the rows
    // most worth looking at.
    captureRequest(
      auditPageBody({ content: [{ ...categoryCreatedEntry, permission: "escrow.freeze" }] }),
    );

    const page = await fetchWith({});

    expect(page.content[0]?.permission).toBe("escrow.freeze");
  });
});

describe("an actor with no staff record", () => {
  it("keeps the row instead of blanking the page", async () => {
    // koala-backend#15 leaves actorStaffId null for a valid staff token with no
    // staff_members row, and for the ADR-0010 bridge-phase marketplace admin.
    // Zod parses the page as a whole, so a non-nullable field here would throw
    // away every other row over exactly the ones worth reading.
    captureRequest(
      auditPageBody({
        content: [
          {
            ...categoryCreatedEntry,
            actorStaffId: null,
            actorDisplayName: "f7c1e0d2-marketplace-admin",
          },
          refusedEntry,
        ],
      }),
    );

    const page = await fetchWith({});

    expect(page.content).toHaveLength(2);
    expect(page.content[0]?.actorStaffId).toBeNull();
    expect(page.content[0]?.actorDisplayName).toBe("f7c1e0d2-marketplace-admin");
    expect(page.content[1]?.id).toBe(refusedEntry.id);
  });

  it("keeps resourceId an empty string when no single record was targeted", async () => {
    captureRequest(auditPageBody({ content: [{ ...categoryCreatedEntry, resourceId: "" }] }));

    const page = await fetchWith({});

    expect(page.content[0]?.resourceId).toBe("");
  });
});
