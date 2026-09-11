import type { Metadata } from "next";

import { AuditLogFilterForm, AuditLogPager } from "@/components/panel/audit-log-filters";
import { PageHeader } from "@/components/panel/page-header";
import { AuditLogTable } from "@/components/panel/audit-log-table";
import { EmptyState, ErrorState } from "@/components/ui";
import {
  activeFilters,
  hasActiveFilters,
  parseAuditLogRequest,
  type AuditEntry,
  type AuditLogRequest,
  type SearchParamsInput,
} from "@/lib/audit-log";
import { getAuditLog } from "@/server/api/audit";
import { isKoalaApiError } from "@/server/api/errors";
import type { PageDto } from "@/server/api/types";
import { getKoalaAccessToken } from "@/server/auth/session";
import { isPermission, permissionLabel } from "@/server/authz/permissions";
import { RequirePermission } from "@/server/authz/require-permission";

export const metadata: Metadata = { title: "Denetim kaydı" };

/**
 * The audit log viewer — koala-admin#10.
 *
 * Three properties of this file are the issue, and each one is easy to undo:
 *
 *  1. **The fetch is inside the gate.** `<AuditLogView>` is passed to
 *     `<RequirePermission>` as an element, not called, so when the gate returns
 *     the 403 state the component function never runs, the token is never read
 *     and `GET /admin/audit-log` never leaves the server. `gate.test.tsx`
 *     asserts that as a request *count* rather than as absent markup.
 *  2. **Filters are read off the URL and sent to the backend.** There is no
 *     branch anywhere below that narrows `page.content`. What the server
 *     returned is what is rendered.
 *  3. **Nothing refreshes on its own.** No `revalidate`, no timer, no
 *     `router.refresh()`, no client fetch. Reading this table is itself a
 *     logged, sensitive read; a poller would spend the afternoon filling the
 *     log with records of itself being read.
 *
 * There is also no edit and no delete on this screen, and there is not meant to
 * ever be one. Retention and KVKK erasure are koala-backend#15's job. A record
 * that the panel could alter would not be worth reading.
 */

interface AuditLogPageProps {
  /**
   * Optional so the page can be rendered without a router in a test, which is
   * how `gate.test.tsx` asserts the request count.
   */
  searchParams?: Promise<SearchParamsInput>;
}

export default async function AuditLogPage({ searchParams }: AuditLogPageProps) {
  const request = parseAuditLogRequest(searchParams === undefined ? undefined : await searchParams);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Denetim kaydı"
        description={
          <>
            Personelin yaptığı işlemlerin kaydı — reddedilen denemeler dâhil. Kayıt salt
            okunurdur: buradan düzenlenemez, silinemez.
          </>
        }
      />

      <RequirePermission permission="audit.read">
        <AuditLogView request={request} />
      </RequirePermission>
    </div>
  );
}

async function AuditLogView({ request }: { request: AuditLogRequest }) {
  const result = await loadAuditLog(request);

  return (
    <div className="flex flex-col gap-4">
      <AuditLogFilterForm filters={request.filters} page={request.page} />

      {result.ok ? (
        <AuditLogResults request={request} page={result.page} />
      ) : (
        <ErrorState
          title={result.title}
          description={result.description}
          errorCode={result.errorCode}
          requestId={result.requestId}
        />
      )}
    </div>
  );
}

function AuditLogResults({
  request,
  page,
}: {
  request: AuditLogRequest;
  page: PageDto<AuditEntry>;
}) {
  if (page.content.length === 0) {
    /**
     * "Nothing was recorded" and "nothing matched what you asked for" are
     * different answers and are told apart here on purpose. Collapsing them is
     * how an operator concludes an action was never logged when in fact their
     * date range was off by a day — a false negative in the one table that is
     * supposed to settle questions like that.
     */
    return hasActiveFilters(request.filters) ? (
      <EmptyState
        title="Filtreye uyan kayıt yok."
        description={`Denetim kaydında kayıt var, ancak uyguladığınız ${activeFilters(request.filters).length} filtreye uyan satır bulunamadı. Filtreler sunucuda uygulanır; aralığı genişletmeyi ya da filtreleri temizlemeyi deneyin.`}
      />
    ) : (
      <EmptyState
        title="Denetim kaydı boş."
        description="Kaydedilmiş bir personel işlemi yok. Hiçbir filtre uygulanmadı, yani bu gerçekten boş bir kayıt — daraltılmış bir sonuç değil."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* The page the server returned, rendered whole. */}
      <AuditLogTable entries={page.content} permissionLabels={permissionLabelsFor(page.content)} />

      <AuditLogPager
        filters={request.filters}
        page={page.page}
        totalPages={page.totalPages}
        totalElements={page.totalElements}
        first={page.first}
        last={page.last}
      />
    </div>
  );
}

/**
 * Turkish labels for the permissions this page happens to be showing.
 *
 * Resolved here because the catalogue lives under `src/server/` and the table
 * is a Client Component; `no-client-secrets.test.ts` keeps that boundary and it
 * is not worth spending for a tooltip. A permission the catalogue does not know
 * — one the backend added after this build — simply has no entry, and the raw
 * name is shown on its own rather than the row being dropped.
 */
function permissionLabelsFor(entries: readonly AuditEntry[]): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const entry of entries) {
    if (isPermission(entry.permission)) {
      labels[entry.permission] = permissionLabel(entry.permission);
    }
  }

  return labels;
}

type LoadResult =
  | { ok: true; page: PageDto<AuditEntry> }
  | {
      ok: false;
      title: string;
      description: string;
      errorCode: string | null;
      requestId: string | null;
    };

async function loadAuditLog(request: AuditLogRequest): Promise<LoadResult> {
  try {
    return { ok: true, page: await getAuditLog(await getKoalaAccessToken(), request) };
  } catch (error) {
    if (isKoalaApiError(error) && error.isForbidden) {
      /**
       * The panel let this render and the backend still said no.
       *
       * That is not a contradiction to paper over — it is the arrangement.
       * `@RequiresPermission` is the authority and the gate upstream is a
       * courtesy, so the honest thing is to show the backend's verdict rather
       * than crash or pretend the list is empty. It is also the answer an
       * unmapped `/admin/**` path gives today (koala-backend#14 refuses by
       * default), which is exactly what this endpoint is until #15 ships.
       */
      return {
        ok: false,
        title: "Backend bu işlem için yetki vermedi.",
        description:
          "Panel sayfayı açtı, backend denetim kaydını vermeyi reddetti. Yetki kararını backend verir; paneldeki menü ve kapılar yalnız gereksiz istekleri önler. Bu uç henüz yayına alınmamış da olabilir — koala-backend eşlenmemiş bir /admin yolunu da 403 ile reddeder.",
        errorCode: error.errorCode,
        requestId: error.requestId,
      };
    }

    if (isKoalaApiError(error)) {
      return {
        ok: false,
        title: "Denetim kaydı yüklenemedi.",
        description: error.message,
        errorCode: error.errorCode,
        requestId: error.requestId,
      };
    }

    return {
      ok: false,
      title: "Denetim kaydı yüklenemedi.",
      description: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.",
      errorCode: null,
      requestId: null,
    };
  }
}
