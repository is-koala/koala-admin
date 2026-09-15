"use client";

import type { ReactNode } from "react";

import { Badge, Button } from "@/components/ui";
import { hasDetailRecord, type AuditEntry } from "@/lib/audit-log";
import { EMPTY_VALUE, formatDateTimeSeconds } from "@/lib/format";

import { SENSITIVITY_PRESENTATION, outcomePresentation } from "./audit-log-presentation";

/**
 * The row detail, in a side panel.
 *
 * The sentence this component exists to make sure gets said is the one under
 * "Ayrıntı": when koala-backend#15's detail row is gone, the panel says the
 * detail was deleted and the core record is intact. An empty `<dl>` would be
 * indistinguishable from a rendering bug, and the difference matters — one is a
 * KVKK erasure working exactly as designed, the other is a defect.
 *
 * A panel rather than a modal: an auditor compares a row against its
 * neighbours, so the table stays visible and stays scrollable behind it.
 *
 * Note what is *not* here: no edit, no delete, no retry, no "hatalı işaretle".
 * The audit log's value is that it cannot be changed from the place it is read.
 */

export interface AuditEntryDetailProps {
  entry: AuditEntry;
  /**
   * Permission name → Turkish label, resolved on the server.
   *
   * Passed in rather than looked up here because the catalogue lives under
   * `src/server/`, and `no-client-secrets.test.ts` holds the line that a Client
   * Component imports nothing from there — a rule worth more than the two lines
   * it costs to obey. A permission the panel does not recognise is simply
   * absent from the map and the raw name stands alone, which is also what
   * happens when the backend records a permission newer than this build.
   */
  permissionLabels: Readonly<Record<string, string>>;
  onClose: () => void;
}

export function AuditEntryDetail({ entry, permissionLabels, onClose }: AuditEntryDetailProps) {
  const label = permissionLabels[entry.permission];
  const outcome = outcomePresentation(entry.allowed);
  const sensitivity = SENSITIVITY_PRESENTATION[entry.sensitivity];
  const detailPresent = hasDetailRecord(entry);

  return (
    <aside
      // Not `role="dialog"`: nothing is trapped and the table behind stays
      // usable, which is the point of a side panel.
      role="complementary"
      aria-label="Denetim kaydı ayrıntısı"
      data-testid="audit-detail"
      data-detail-present={String(detailPresent)}
      className="flex w-full shrink-0 flex-col gap-4 rounded-lg border border-border-subtle bg-surface p-4 lg:w-96"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold text-ink">Denetim kaydı ayrıntısı</h2>
          <p className="font-mono text-xs break-all text-ink-subtle">{entry.id}</p>
        </div>
        <Button variant="secondary" size="sm" type="button" onClick={onClose}>
          Kapat
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">
          Çekirdek kayıt
        </h3>
        <dl className="flex flex-col gap-2 text-sm">
          <Field label="Zaman">
            <time dateTime={entry.occurredAt} className="tabular-nums">
              {formatDateTimeSeconds(entry.occurredAt)}
            </time>
          </Field>
          <Field label="Aktör">
            <span>{entry.actorDisplayName}</span>
            <span className="block font-mono text-xs break-all text-ink-subtle">
              {entry.actorStaffId ?? "Personel kaydı yok"}
            </span>
          </Field>
          <Field label="Eylem">
            <span className="font-mono text-xs">{entry.action}</span>
          </Field>
          <Field label="İzin">
            <span className="font-mono text-xs">{entry.permission}</span>
            {label === undefined ? null : (
              <span className="block text-xs text-ink-muted">{label}</span>
            )}
          </Field>
          <Field label="Kaynak">
            <span className="font-mono text-xs break-all">
              {entry.resourceType} · {entry.resourceId}
            </span>
          </Field>
          <Field label="Sonuç">
            <Badge tone={outcome.tone}>{outcome.label}</Badge>
          </Field>
          <Field label="Hassasiyet">
            <Badge tone={sensitivity.tone}>{sensitivity.label}</Badge>
          </Field>
          <Field label="Türü">
            <span>{entry.mutating ? "Değiştiren işlem" : "Yalnız okuma"}</span>
          </Field>
        </dl>
      </section>

      <section className="flex flex-col gap-2 border-t border-border-subtle pt-4">
        <h3 className="text-xs font-semibold tracking-wide text-ink-muted uppercase">Ayrıntı</h3>

        {detailPresent ? (
          <dl className="flex flex-col gap-2 text-sm">
            <Field label="IP">
              <span className="font-mono text-xs">{entry.ip ?? EMPTY_VALUE}</span>
            </Field>
            <Field label="User agent">
              <span className="font-mono text-xs break-all">{entry.userAgent ?? EMPTY_VALUE}</span>
            </Field>
            <Snapshot label="İstek gövdesi" value={entry.requestBody} />
            <Snapshot label="Öncesi" value={entry.before} />
            <Snapshot label="Sonrası" value={entry.after} />
          </dl>
        ) : (
          <p
            data-testid="audit-detail-erased"
            className="rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-sm text-ink"
          >
            Bu satırın{" "}
            <strong>saklama süresi dolduğu için detay silindi, çekirdek kayıt duruyor</strong>. IP,
            user agent, istek gövdesi ve öncesi/sonrası anlık görüntüleri artık yok; kim, ne zaman,
            neyi denedi ve sonucu ne oldu bilgisi yukarıda duruyor. Silme koala-backend#15&apos;in
            saklama işi ya da bir KVKK talebi ile yapılır; panelden tetiklenmez ve geri alınamaz.
          </p>
        )}
      </section>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd className="text-ink">{children}</dd>
    </div>
  );
}

function Snapshot({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-ink-muted">{label}</dt>
      <dd>
        {value === null ? (
          <span className="text-ink-subtle">{EMPTY_VALUE}</span>
        ) : (
          <pre className="max-h-48 overflow-auto rounded-md bg-surface-sunken p-2 font-mono text-xs whitespace-pre-wrap text-ink">
            {value}
          </pre>
        )}
      </dd>
    </div>
  );
}
