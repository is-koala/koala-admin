"use client";

import Link from "next/link";
import { useState } from "react";

import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import type { AuditEntry } from "@/lib/audit-log";
import {
  auditActorHref,
  auditResourceHref,
  type AuditLinkPermission as Permission,
} from "@/lib/audit-links";
import { formatDateTimeSeconds } from "@/lib/format";

import { AuditEntryDetail } from "./audit-log-detail";
import { SENSITIVITY_PRESENTATION, outcomePresentation } from "./audit-log-presentation";

/**
 * The audit table, and the one Client Component on this screen.
 *
 * It is a Client Component for exactly one reason — opening a row's detail must
 * not cost a request. The whole row, detail fields included, is already in the
 * page the server fetched, so selecting one is local state. That is not a
 * micro-optimisation: reading the audit log is itself an audited, sensitive
 * read (koala-backend#15), so a viewer that fetched on every row click would
 * write a row into the table it is being used to read.
 *
 * The same reasoning is why there is no `useEffect` here, no timer, no
 * `router.refresh()` and no SWR-style revalidation. New rows arrive when a
 * person presses "Yenile" and at no other moment. `audit-log-table.test.tsx`
 * runs the clock forward ten minutes and asserts nothing was fetched.
 *
 * And nothing in this component filters `entries`. It renders the page the
 * server returned, in the order the server returned it.
 *
 * Aktör ve kaynak bağlantılı (koala-admin#107): aktör `/staff` çapasına,
 * kaynak `resourceType`'a göre nesne sayfasına. Bağlantı yalnız hedefin
 * izni `permissions`'ta varken verilir — sunucu çözer, buraya liste gelir;
 * izinsiz kişiye verilen bağlantı 403 ekranı olurdu. Liste boşsa hiçbir
 * hücre bağlanmaz; satır yine çizilir.
 */

export interface AuditLogTableProps {
  entries: readonly AuditEntry[];
  /** Permission name → Turkish label, resolved on the server. See the detail panel. */
  permissionLabels: Readonly<Record<string, string>>;
  /** Okuyanın izinleri; kaynak ve aktör bağlantıları buna göre açılır. */
  permissions?: readonly Permission[];
}

export function AuditLogTable({ entries, permissionLabels, permissions = [] }: AuditLogTableProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = entries.find((entry) => entry.id === selectedId) ?? null;
  const held = new Set<Permission>(permissions);

  return (
    <div className="flex flex-col items-start gap-4 lg:flex-row">
      <div className="w-full min-w-0 flex-1">
        <Table caption="Personel işlemleri">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Zaman</TableHeaderCell>
              <TableHeaderCell>Aktör</TableHeaderCell>
              <TableHeaderCell>Eylem</TableHeaderCell>
              <TableHeaderCell>İzin</TableHeaderCell>
              <TableHeaderCell>Kaynak</TableHeaderCell>
              <TableHeaderCell>Hassasiyet</TableHeaderCell>
              <TableHeaderCell>Sonuç</TableHeaderCell>
              <TableHeaderCell>
                <span className="sr-only">Ayrıntı</span>
              </TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {entries.map((entry) => {
              const outcome = outcomePresentation(entry.allowed);
              const sensitivity = SENSITIVITY_PRESENTATION[entry.sensitivity];

              return (
                <TableRow
                  key={entry.id}
                  data-testid="audit-row"
                  data-allowed={String(entry.allowed)}
                  data-sensitivity={entry.sensitivity}
                  /**
                   * The refused rows are tinted, not merely badged. They are the
                   * only visible trace of an attempt that should not have been
                   * made, and a reviewer scrolling a page of twenty-five has to
                   * be able to find them without reading every line.
                   */
                  className={
                    entry.allowed
                      ? undefined
                      : "bg-danger-soft hover:bg-danger-soft/80 border-l-4 border-l-danger"
                  }
                >
                  <TableCell>
                    <time dateTime={entry.occurredAt} className="tabular-nums">
                      {formatDateTimeSeconds(entry.occurredAt)}
                    </time>
                  </TableCell>
                  <TableCell>
                    <ActorCell entry={entry} held={held} />
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{entry.action}</span>
                  </TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{entry.permission}</span>
                  </TableCell>
                  <TableCell>
                    <ResourceCell entry={entry} held={held} />
                  </TableCell>
                  <TableCell>
                    <Badge tone={sensitivity.tone}>{sensitivity.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <Badge tone={outcome.tone}>{outcome.label}</Badge>
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      aria-expanded={selectedId === entry.id}
                      onClick={() =>
                        setSelectedId((current) => (current === entry.id ? null : entry.id))
                      }
                      className="button button--secondary button--sm"
                    >
                      Ayrıntı
                    </button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {selected === null ? null : (
        <AuditEntryDetail
          entry={selected}
          permissionLabels={permissionLabels}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
}

function ActorCell({ entry, held }: { entry: AuditEntry; held: ReadonlySet<Permission> }) {
  const href = auditActorHref(entry.actorStaffId, held);
  if (href === null) return <>{entry.actorDisplayName}</>;
  return (
    <Link href={href} className="text-brand hover:underline" data-testid="audit-actor-link">
      {entry.actorDisplayName}
    </Link>
  );
}

function ResourceCell({ entry, held }: { entry: AuditEntry; held: ReadonlySet<Permission> }) {
  const href = auditResourceHref(entry.resourceType, entry.resourceId, held);
  return (
    <span className="font-mono text-xs break-all text-ink-subtle">
      {entry.resourceType} ·{" "}
      {href === null ? (
        entry.resourceId
      ) : (
        <Link href={href} className="text-brand hover:underline" data-testid="audit-resource-link">
          {entry.resourceId}
        </Link>
      )}
    </span>
  );
}
