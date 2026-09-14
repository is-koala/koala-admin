import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adminAssignmentFixture } from "../../../test/fixtures/admin-assignment";
import {
  ASSIGNMENT_ID,
  JOB_ID,
  PAYOUT_ID,
  adminJobFixture,
  envelope,
  pageEnvelope,
} from "../../../test/fixtures/admin-detail";
import { reviewCompany } from "../../../test/fixtures/companies";
import { resourceNotFoundBody } from "../../../test/fixtures/envelopes";
import { apiUrl, server } from "../../../test/msw";
import { GLOBAL_SEARCH_GROUP_SIZE, SEARCH_GROUP_KINDS } from "@/lib/global-search";
import type { Permission } from "@/server/authz/permissions";

import { GROUP_PERMISSIONS, OBJECT_TARGETS, globalSearch } from "./global-search";

/**
 * Global aramanın sunucu yarısı (koala-admin#104).
 *
 * İddiaların çoğu **istek sayısı ve yolu** üzerinden: izin süzgeci "cevapta
 * yok" değil "hiç sorulmadı" demektir, ve bunu yalnız MSW'nin gördüğü
 * istekler kanıtlar. `onUnhandledRequest: "error"` sayesinde stub'lanmamış
 * bir uca giden istek testi düşürür — yani izinsiz bir ucun sorulmaması bir
 * varsayım değil, ölçülen bir şeydir.
 */

const UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const TOKEN = "ACCESS-TOKEN";

const ALL_PERMISSIONS: readonly Permission[] = [
  "user.read",
  "user.read_pii",
  "payment.read",
  "payout.reconcile",
  "dispute.resolve",
  "job.read",
  "company.approve",
];

function hasOnly(permissions: readonly Permission[]) {
  return (permission: Permission) => permissions.includes(permission);
}

function notFound(path: string) {
  return HttpResponse.json({ ...resourceNotFoundBody, path }, { status: 404 });
}

/** Her hedefi 404'e bağlar ve yolları kaydeder; test istediğini üstüne yazar. */
function stubAllObjectsNotFound(seen: string[]) {
  for (const target of OBJECT_TARGETS) {
    const path = target.path(UUID);
    server.use(
      http.get(apiUrl(path), () => {
        seen.push(path);
        return notFound(path);
      }),
    );
  }
}

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("a UUID probes every permitted object endpoint in parallel", () => {
  it("opens the first endpoint that answers 200", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);
    const payoutPath = `/admin/payouts/${UUID}`;
    server.use(
      http.get(apiUrl(payoutPath), () =>
        HttpResponse.json(envelope(payoutPath, { id: UUID, status: "COMPLETED" })),
      ),
    );

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(ALL_PERMISSIONS),
      query: UUID,
    });

    expect(result).toEqual({
      kind: "object",
      objectKind: "payout",
      href: `/payout-reconciliation/${UUID}`,
    });
    // Yedi hedefin hepsi soruldu; 404'ler yarışı kaybetti, cevabı değil.
    expect(seen).toHaveLength(OBJECT_TARGETS.length - 1);
  });

  it("accepts an upper-case UUID and normalises it before asking", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);
    const userPath = `/admin/users/${UUID}`;
    server.use(
      http.get(apiUrl(userPath), () => HttpResponse.json(envelope(userPath, { id: UUID }))),
    );

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["user.read"]),
      query: `  ${UUID.toUpperCase()}  `,
    });

    expect(result).toMatchObject({ kind: "object", objectKind: "user", href: `/users/${UUID}` });
  });

  it("reports not-found when every permitted endpoint says 404, naming what was probed", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(ALL_PERMISSIONS),
      query: UUID,
    });

    expect(result).toEqual({
      kind: "not-found",
      probed: OBJECT_TARGETS.map((target) => target.kind),
    });
    expect(new Set(seen).size).toBe(OBJECT_TARGETS.length);
  });

  it("never asks an endpoint the staff member lacks the permission for", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["user.read", "dispute.resolve"]),
      query: UUID,
    });

    expect(result).toEqual({ kind: "not-found", probed: ["user", "dispute"] });
    expect(seen.sort()).toEqual([`/admin/disputes/${UUID}`, `/admin/users/${UUID}`]);
  });

  it("says no-permission, and makes no request, when nothing may be probed", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);

    const result = await globalSearch({ accessToken: TOKEN, has: () => false, query: UUID });

    expect(result).toEqual({ kind: "no-permission" });
    expect(seen).toEqual([]);
  });

  it("does not call an all-404 answer 'not found' when one endpoint failed with 5xx", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);
    const jobPath = `/admin/jobs/${UUID}`;
    server.use(http.get(apiUrl(jobPath), () => HttpResponse.text("boom", { status: 503 })));

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(ALL_PERMISSIONS),
      query: UUID,
    });

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("surfaces a 429 as rate-limited so the palette backs off", async () => {
    const seen: string[] = [];
    stubAllObjectsNotFound(seen);
    const userPath = `/admin/users/${UUID}`;
    server.use(
      http.get(apiUrl(userPath), () =>
        HttpResponse.json(
          {
            ...resourceNotFoundBody,
            path: userPath,
            httpStatus: "429 TOO_MANY_REQUESTS",
            errorCode: "TOO_MANY_REQUESTS",
            errorCategory: "RATE_LIMITED",
          },
          { status: 429 },
        ),
      ),
    );

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(ALL_PERMISSIONS),
      query: UUID,
    });

    expect(result).toMatchObject({ kind: "rate-limited" });
    expect((result as { retryAfterMs: number }).retryAfterMs).toBeGreaterThan(0);
  });
});

describe("free text fans out to the permitted list endpoints", () => {
  function stubLists(seen: URL[]) {
    server.use(
      http.get(apiUrl("/admin/users"), ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(
          pageEnvelope("/admin/users", [
            { id: "u-1", firstName: "Ayşe", lastName: "Yılmaz", username: "ayse" },
          ]),
        );
      }),
      http.get(apiUrl("/admin/jobs"), ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(pageEnvelope("/admin/jobs", [adminJobFixture()]));
      }),
      http.get(apiUrl("/admin/companies"), ({ request }) => {
        const url = new URL(request.url);
        seen.push(url);
        const status = url.searchParams.get("status");
        return HttpResponse.json(
          pageEnvelope(
            "/admin/companies",
            status === "APPROVED" ? [reviewCompany({ approvalStatus: "APPROVED" })] : [],
          ),
        );
      }),
      http.get(apiUrl("/admin/job-assignments"), ({ request }) => {
        seen.push(new URL(request.url));
        return HttpResponse.json(
          pageEnvelope("/admin/job-assignments", [adminAssignmentFixture()]),
        );
      }),
    );
  }

  it("asks users, jobs, companies (every approval status) and assignments, five each, and groups the answers", async () => {
    const seen: URL[] = [];
    stubLists(seen);

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(ALL_PERMISSIONS),
      query: "ayşe",
    });

    expect(result).toMatchObject({ kind: "groups", query: "ayşe", failures: [] });
    if (result.kind !== "groups") throw new Error("groups bekleniyordu");

    expect(result.groups.map((group) => group.kind)).toEqual([...SEARCH_GROUP_KINDS]);
    expect(result.groups.find((group) => group.kind === "user")?.hits).toEqual([
      { id: "u-1", href: "/users/u-1", title: "Ayşe Yılmaz", subtitle: "@ayse" },
    ]);
    expect(result.groups.find((group) => group.kind === "job")?.hits[0]).toMatchObject({
      id: JOB_ID,
      href: `/jobs/${JOB_ID}`,
      title: "Garsonluk",
      subtitle: "Açık · Koala Kafe · İstanbul / Kadıköy",
    });
    expect(result.groups.find((group) => group.kind === "company")?.hits[0]).toMatchObject({
      href: `/companies/${reviewCompany().id}`,
      title: "Koala Kahve A.Ş.",
    });
    expect(result.groups.find((group) => group.kind === "assignment")?.hits[0]).toMatchObject({
      id: ASSIGNMENT_ID,
      href: `/assignments/${ASSIGNMENT_ID}`,
      title: "Garsonluk",
      subtitle: "Tamamlandı · Ayşe Yılmaz · Koala Kafe",
    });

    // Her istek `query=ayşe&size=5`; şirket üç durum için üç kez.
    for (const url of seen) {
      expect(url.searchParams.get("query")).toBe("ayşe");
      expect(url.searchParams.get("size")).toBe(String(GLOBAL_SEARCH_GROUP_SIZE));
    }
    const companyStatuses = seen
      .filter((url) => url.pathname === "/admin/companies")
      .map((url) => url.searchParams.get("status"))
      .sort();
    expect(companyStatuses).toEqual(["APPROVED", "PENDING", "REJECTED"]);
    expect(seen.filter((url) => url.pathname !== "/admin/companies")).toHaveLength(3);
  });

  it("requests only the groups the staff member may read", async () => {
    const seen: URL[] = [];
    stubLists(seen);

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["user.read", "payment.read"]),
      query: "ayşe",
    });

    if (result.kind !== "groups") throw new Error("groups bekleniyordu");
    expect(result.groups.map((group) => group.kind)).toEqual(["user", "assignment"]);
    expect(seen.map((url) => url.pathname).sort()).toEqual([
      "/admin/job-assignments",
      "/admin/users",
    ]);
  });

  it("writes the employer's e-mail only for a holder of user.read_pii", async () => {
    const seen: URL[] = [];
    stubLists(seen);
    server.use(
      http.get(apiUrl("/admin/jobs"), () =>
        HttpResponse.json(
          pageEnvelope("/admin/jobs", [
            adminJobFixture({
              companyName: null,
              employer: { id: "e-9", firstName: null, lastName: null, email: "gizli@example.com" },
            }),
          ]),
        ),
      ),
    );

    const withPii = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["job.read", "user.read_pii"]),
      query: "garson",
    });
    const withoutPii = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["job.read"]),
      query: "garson",
    });

    const subtitle = (result: typeof withPii) =>
      result.kind === "groups" ? result.groups[0]?.hits[0]?.subtitle : null;
    expect(subtitle(withPii)).toContain("gizli@example.com");
    expect(subtitle(withoutPii)).not.toContain("gizli@example.com");
    expect(JSON.stringify(withoutPii)).not.toContain("gizli@example.com");
  });

  it("keeps the other groups when one endpoint fails, and names the failed one", async () => {
    const seen: URL[] = [];
    stubLists(seen);
    server.use(
      http.get(apiUrl("/admin/job-assignments"), () => HttpResponse.text("boom", { status: 500 })),
    );

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(ALL_PERMISSIONS),
      query: "ayşe",
    });

    if (result.kind !== "groups") throw new Error("groups bekleniyordu");
    expect(result.groups.map((group) => group.kind)).toEqual(["user", "job", "company"]);
    expect(result.failures).toEqual([{ kind: "assignment", reason: "upstream" }]);
  });

  it("is unavailable when every requested endpoint failed", async () => {
    server.use(http.get(apiUrl("/admin/users"), () => HttpResponse.text("boom", { status: 502 })));

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["user.read"]),
      query: "ayşe",
    });

    expect(result).toEqual({ kind: "unavailable" });
  });

  it("is idle for a query the backend would not filter on, and makes no request", async () => {
    const seen: URL[] = [];
    stubLists(seen);

    expect(
      await globalSearch({ accessToken: TOKEN, has: hasOnly(ALL_PERMISSIONS), query: "a" }),
    ).toEqual({
      kind: "idle",
    });
    expect(
      await globalSearch({ accessToken: TOKEN, has: hasOnly(ALL_PERMISSIONS), query: "   " }),
    ).toEqual({
      kind: "idle",
    });
    expect(seen).toEqual([]);
  });

  it("says no-permission without a request when no group is readable", async () => {
    const seen: URL[] = [];
    stubLists(seen);

    const result = await globalSearch({
      accessToken: TOKEN,
      has: hasOnly(["audit.read"]),
      query: "ayşe",
    });

    expect(result).toEqual({ kind: "no-permission" });
    expect(seen).toEqual([]);
  });
});

describe("the registries agree with the route table", () => {
  it("maps every group and object target to a permission the panel knows", () => {
    for (const kind of SEARCH_GROUP_KINDS) {
      expect(GROUP_PERMISSIONS[kind]).toBeTypeOf("string");
    }
    expect(OBJECT_TARGETS.map((target) => target.kind)).toEqual([
      "user",
      "assignment",
      "payment",
      "payout",
      "dispute",
      "job",
      "company",
    ]);
    expect(OBJECT_TARGETS.find((target) => target.kind === "payout")?.path(PAYOUT_ID)).toBe(
      `/admin/payouts/${PAYOUT_ID}`,
    );
  });
});
