import type { Metadata } from "next";

import {
  ErrorState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EmptyState } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import { getAuditLog, type AuditLogEntry } from "@/server/api/audit";
import { isKoalaApiError } from "@/server/api/errors";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";

export const metadata: Metadata = { title: "Denetim kaydı" };

/**
 * The gated page, and the one this slice's acceptance criteria are written
 * against.
 *
 * Look at where the fetch is. `AuditLogTable` is passed to
 * `<RequirePermission>` as an element, not called — so when the gate returns
 * the 403 state instead of its children, this component never runs, the token
 * is never read and `GET /admin/audit-log` never leaves the server. That is the
 * difference between a gate and a hidden `<div>`, and `gate.test.tsx` asserts
 * the request count rather than the absence of markup.
 *
 * The header is outside the gate on purpose: someone who followed a link should
 * be told which page refused them, not shown a blank frame.
 */
export default async function AuditLogPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Denetim kaydı</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Personelin yaptığı işlemlerin kaydı. <code className="font-mono">audit.read</code> izni
          gerektirir.
        </p>
      </header>

      <RequirePermission permission="audit.read">
        <AuditLogTable />
      </RequirePermission>
    </div>
  );
}

async function AuditLogTable() {
  const result = await loadAuditLog();

  if (!result.ok) {
    return (
      <ErrorState
        title={result.title}
        description={result.description}
        errorCode={result.errorCode}
        correlationId={result.correlationId}
      />
    );
  }

  if (result.entries.length === 0) {
    return (
      <EmptyState title="Denetim kaydı boş." description="Kaydedilmiş bir personel işlemi yok." />
    );
  }

  return (
    <Table caption="Personel işlemleri">
      <TableHead>
        <TableRow>
          <TableHeaderCell>Zaman</TableHeaderCell>
          <TableHeaderCell>Personel</TableHeaderCell>
          <TableHeaderCell>İşlem</TableHeaderCell>
          <TableHeaderCell>Kayıt</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {result.entries.map((entry) => (
          <TableRow key={entry.id}>
            <TableCell>{formatDateTime(new Date(entry.at))}</TableCell>
            <TableCell>{entry.actor}</TableCell>
            <TableCell>
              <span className="font-mono text-xs">{entry.action}</span>
            </TableCell>
            <TableCell>
              <span className="font-mono text-xs text-ink-subtle">
                {[entry.resource, entry.resourceId].filter(Boolean).join(" · ") || "—"}
              </span>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

type LoadResult =
  | { ok: true; entries: AuditLogEntry[] }
  | {
      ok: false;
      title: string;
      description: string;
      errorCode: string | null;
      correlationId: string | null;
    };

async function loadAuditLog(): Promise<LoadResult> {
  try {
    const page = await getAuditLog(await getKoalaAccessToken());
    return { ok: true, entries: page.content };
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
       * default), which is exactly what this endpoint is until it ships.
       */
      return {
        ok: false,
        title: "Backend bu işlem için yetki vermedi.",
        description:
          "Panel sayfayı açtı, backend denetim kaydını vermeyi reddetti. Yetki kararını backend verir; paneldeki menü ve kapılar yalnız gereksiz istekleri önler. Bu uç henüz yayına alınmamış da olabilir — koala-backend eşlenmemiş bir /admin yolunu da 403 ile reddeder.",
        errorCode: error.errorCode,
        correlationId: error.correlationId,
      };
    }

    if (isKoalaApiError(error)) {
      return {
        ok: false,
        title: "Denetim kaydı yüklenemedi.",
        description: error.message,
        errorCode: error.errorCode,
        correlationId: error.correlationId,
      };
    }

    return {
      ok: false,
      title: "Denetim kaydı yüklenemedi.",
      description: error instanceof Error ? error.message : "Bilinmeyen bir hata oluştu.",
      errorCode: null,
      correlationId: null,
    };
  }
}
