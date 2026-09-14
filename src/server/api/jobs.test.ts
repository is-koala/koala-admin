import { HttpResponse, http } from "msw";
import { describe, expect, it } from "vitest";

import { apiUrl, server } from "../../../test/msw";
import {
  JOB_ID,
  adminJobDetailFixture,
  adminJobFixture,
  envelope,
  pageEnvelope,
} from "../../../test/fixtures/admin-detail";

import {
  JOB_PAGING,
  JOBS_PATH,
  formatJobAddress,
  getAdminJob,
  getAdminJobs,
  jobPath,
  staffPartyName,
} from "./jobs";
import { readPaging } from "./paging";

/** `GET /admin/jobs` ve `GET /admin/jobs/{jobId}` (koala-backend#265). */

describe("getAdminJobs", () => {
  it("omits status for 'all', sends query and the sanitised sort", async () => {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(JOBS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(pageEnvelope(JOBS_PATH, [adminJobFixture()]));
      }),
    );

    const page = await getAdminJobs("TOKEN", {
      status: null,
      query: "garson",
      paging: readPaging({ sirala: "salary,asc", boyut: "10" }, JOB_PAGING),
    });

    expect(seen.url?.searchParams.get("status")).toBeNull();
    expect(seen.url?.searchParams.get("query")).toBe("garson");
    expect(seen.url?.searchParams.get("sort")).toBe("salary,asc");
    expect(seen.url?.searchParams.get("size")).toBe("10");
    expect(page.content[0]?.applicationCount).toBe(12);
    expect(page.content[0]?.startDateTime).toBe("2026-09-20T09:00:00");
  });

  it("sends a chosen status", async () => {
    const seen: { url: URL | null } = { url: null };
    server.use(
      http.get(apiUrl(JOBS_PATH), ({ request }) => {
        seen.url = new URL(request.url);
        return HttpResponse.json(pageEnvelope(JOBS_PATH, []));
      }),
    );

    await getAdminJobs("TOKEN", { status: "CLOSED", paging: readPaging({}, JOB_PAGING) });

    expect(seen.url?.searchParams.get("status")).toBe("CLOSED");
  });

  it("drops a sort field JobManager does not accept", () => {
    expect(readPaging({ sirala: "employer,asc" }, JOB_PAGING).sort).toEqual({
      field: "createdAt",
      direction: "desc",
    });
    expect(JOB_PAGING.sortable).toEqual(["createdAt", "salary", "startDateTime", "title"]);
  });
});

describe("getAdminJob", () => {
  it("reads the detail with its address, images and company", async () => {
    server.use(
      http.get(apiUrl(jobPath(JOB_ID)), () =>
        HttpResponse.json(envelope(jobPath(JOB_ID), adminJobDetailFixture())),
      ),
    );

    const job = await getAdminJob("TOKEN", JOB_ID);

    expect(job.address?.components?.neighborhood).toBe("Caferağa Mah.");
    expect(job.images).toHaveLength(1);
    expect(job.company?.taxNumber).toBe("1234567890");
    expect(job.employer?.email).toBe("mehmet@example.com");
  });

  it("tolerates a detail with nothing optional filled in", async () => {
    server.use(
      http.get(apiUrl(jobPath(JOB_ID)), () =>
        HttpResponse.json(envelope(jobPath(JOB_ID), { id: JOB_ID, status: "CANCELLED" })),
      ),
    );

    const job = await getAdminJob("TOKEN", JOB_ID);

    expect(job.title).toBeNull();
    expect(job.images).toEqual([]);
    expect(job.address).toBeNull();
    expect(job.pricing).toBeNull();
  });
});

describe("helpers", () => {
  it("names an employer by name, then e-mail, then id", () => {
    expect(staffPartyName({ id: "e-1", firstName: "Mehmet", lastName: "Demir", email: null })).toBe(
      "Mehmet Demir",
    );
    expect(staffPartyName({ id: "e-1", firstName: null, lastName: null, email: "m@x.test" })).toBe(
      "m@x.test",
    );
    expect(staffPartyName({ id: "e-1", firstName: " ", lastName: null, email: null })).toBe("e-1");
    expect(staffPartyName(null)).toBe("—");
  });

  it("joins the address components in reading order and skips blanks", () => {
    const job = adminJobDetailFixture();
    const address = job.address as Parameters<typeof formatJobAddress>[0];

    expect(formatJobAddress(address)).toBe(
      "Caferağa Mah., Moda Cad., No 12, Kat 2, Daire 5, 34710, Kadıköy, İstanbul, Türkiye",
    );
    expect(formatJobAddress(null)).toBeNull();
    expect(
      formatJobAddress({
        id: null,
        countryName: null,
        cityName: null,
        districtName: null,
        components: null,
        displayAddress: null,
        needsReview: null,
      }),
    ).toBeNull();
  });
});
