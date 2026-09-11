import "server-only";

import { NO_AUDIT_FILTERS, type AuditEntry } from "@/lib/audit-log";
import type { Permission } from "@/server/authz/permissions";

import { DELETION_PAGING, getAccountDeletions } from "./account-deletions";
import { getAuditLog } from "./audit";
import { getCompanies, COMPANY_PAGING } from "./companies";
import { getDisputes } from "./disputes";
import { getFinanceSummary, type FinanceSummary } from "./finance";
import { getPendingIbanVerifications, IBAN_PENDING_PAGING } from "./iban-verification";
import { getIdentityReviews, IDENTITY_REVIEW_PAGING } from "./identity-reviews";
import { getReports, REPORT_PAGING } from "./reports";
import type { Paging } from "./paging";

const COUNT_PAGE: Paging = {
  page: 0,
  size: 1,
  sort: { field: "createdAt", direction: "desc" },
};

export type OpsQueueHref =
  | "/identity-reviews"
  | "/reports"
  | "/companies"
  | "/disputes"
  | "/iban-verifications"
  | "/account-deletions";

export interface OpsQueueTile {
  readonly href: OpsQueueHref;
  readonly label: string;
  readonly count: number | null;
  readonly oldestAt: string | null;
}

export interface OpsHome {
  readonly queues: readonly OpsQueueTile[];
  readonly finance: FinanceSummary | null;
  readonly recentAudit: readonly AuditEntry[];
}

/**
 * Bugünün işi. İzni olmayan kuyruk hiç istenmez; bir uç düşerse karo durur,
 * sayı uydurulmaz. Finans ve denetim ayrı izinlerdir.
 */
export async function loadOpsHome(
  accessToken: string,
  permissions: readonly Permission[],
): Promise<OpsHome> {
  const held = new Set<Permission>(permissions);
  const jobs: Array<Promise<OpsQueueTile>> = [];

  if (held.has("identity.review")) {
    jobs.push(
      countTile("/identity-reviews", "Kimlik incelemeleri", () =>
        getIdentityReviews(accessToken, {
          status: "PENDING",
          paging: {
            ...countPaging(IDENTITY_REVIEW_PAGING),
            sort: { field: "createdAt", direction: "asc" },
          },
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
  if (held.has("bank.account.verify")) {
    jobs.push(
      countTile("/iban-verifications", "IBAN doğrulama", () =>
        getPendingIbanVerifications(accessToken, countPaging(IBAN_PENDING_PAGING)),
      ),
    );
  }
  if (held.has("user.read_pii")) {
    jobs.push(
      countTile("/account-deletions", "Hesap silme", () =>
        getAccountDeletions(accessToken, {
          status: "REQUESTED",
          paging: countPaging(DELETION_PAGING),
        }),
      ),
    );
  }

  const [queues, finance, recentAudit] = await Promise.all([
    Promise.all(jobs),
    held.has("finance.read") ? readFinance(accessToken) : Promise.resolve(null),
    held.has("audit.read") ? readRecentAudit(accessToken) : Promise.resolve([]),
  ]);

  return { queues, finance, recentAudit };
}

export async function loadOpsSnapshot(
  accessToken: string,
  permissions: readonly Permission[],
): Promise<readonly OpsQueueTile[]> {
  return (await loadOpsHome(accessToken, permissions)).queues;
}

function countPaging(contract: { defaultSort: Paging["sort"] }): Paging {
  return { ...COUNT_PAGE, sort: contract.defaultSort };
}

async function countTile(
  href: OpsQueueTile["href"],
  label: string,
  load: () => Promise<{ totalElements: number; content: readonly unknown[] }>,
): Promise<OpsQueueTile> {
  try {
    const page = await load();
    return { href, label, count: page.totalElements, oldestAt: oldestTimestamp(page.content[0]) };
  } catch {
    return { href, label, count: null, oldestAt: null };
  }
}

function oldestTimestamp(row: unknown): string | null {
  if (row === null || typeof row !== "object") {
    return null;
  }
  const record = row as { createdAt?: unknown; requestedAt?: unknown; startedAt?: unknown };
  const value = record.createdAt ?? record.requestedAt ?? record.startedAt;
  return typeof value === "string" && value.length > 0 ? value : null;
}

async function readFinance(accessToken: string): Promise<FinanceSummary | null> {
  try {
    return await getFinanceSummary(accessToken, {});
  } catch {
    return null;
  }
}

async function readRecentAudit(accessToken: string): Promise<readonly AuditEntry[]> {
  try {
    const page = await getAuditLog(accessToken, {
      filters: NO_AUDIT_FILTERS,
      page: 0,
      size: 8,
    });
    return page.content;
  } catch {
    return [];
  }
}
