import "server-only";

import { getCompanies, COMPANY_PAGING } from "./companies";
import { getDisputes } from "./disputes";
import { getIdentityReviews, IDENTITY_REVIEW_PAGING } from "./identity-reviews";
import { getReports, REPORT_PAGING } from "./reports";
import type { Paging } from "./paging";
import type { Permission } from "@/server/authz/permissions";

const COUNT_PAGE: Paging = {
  page: 0,
  size: 1,
  sort: { field: "createdAt", direction: "desc" },
};

export interface OpsQueueTile {
  readonly href: "/identity-reviews" | "/reports" | "/companies" | "/disputes";
  readonly label: string;
  readonly count: number | null;
}

/**
 * Bekleyen iş sayıları. İzni olmayan kuyruk hiç istenmez; bir uç düşerse
 * karo durur, sayı uydurulmaz.
 */
export async function loadOpsSnapshot(
  accessToken: string,
  permissions: readonly Permission[],
): Promise<readonly OpsQueueTile[]> {
  const held = new Set<Permission>(permissions);
  const jobs: Array<Promise<OpsQueueTile>> = [];

  if (held.has("identity.review")) {
    jobs.push(
      countTile("/identity-reviews", "Kimlik incelemeleri", () =>
        getIdentityReviews(accessToken, {
          status: "PENDING",
          paging: countPaging(IDENTITY_REVIEW_PAGING),
        }),
      ),
    );
  }
  if (held.has("content.moderate")) {
    jobs.push(
      countTile("/reports", "Şikayetler", () =>
        getReports(accessToken, { status: "OPEN", paging: countPaging(REPORT_PAGING) }),
      ),
    );
  }
  if (held.has("company.approve")) {
    jobs.push(
      countTile("/companies", "Şirket onayları", () =>
        getCompanies(accessToken, {
          status: "PENDING",
          query: null,
          paging: countPaging(COMPANY_PAGING),
        }),
      ),
    );
  }
  if (held.has("dispute.resolve")) {
    jobs.push(
      countTile("/disputes", "Uyuşmazlıklar", async () =>
        getDisputes(accessToken, { page: 0, size: 1 }),
      ),
    );
  }

  return Promise.all(jobs);
}

function countPaging(contract: { defaultSort: Paging["sort"] }): Paging {
  return { ...COUNT_PAGE, sort: contract.defaultSort };
}

async function countTile(
  href: OpsQueueTile["href"],
  label: string,
  load: () => Promise<{ totalElements: number }>,
): Promise<OpsQueueTile> {
  try {
    const page = await load();
    return { href, label, count: page.totalElements };
  } catch {
    return { href, label, count: null };
  }
}
