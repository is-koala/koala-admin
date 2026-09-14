import Link from "next/link";
import type { ReactNode } from "react";

import { QueueLoadFailure, type QueueFailure } from "@/components/panel/queue";
import {
  Badge,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { NO_AUDIT_FILTERS, type AuditEntry } from "@/lib/audit-log";
import { auditActorHref } from "@/lib/audit-links";
import { EMPTY_VALUE, formatDateTimeSeconds, formatInteger } from "@/lib/format";
import {
  auditTimelineEvents,
  mergeTimeline,
  shortId,
  type TimelineActor,
  type TimelineEvent,
} from "@/lib/object-timeline";
import { auditLogForResourceHref, userHrefOrNull } from "@/lib/panel-href";
import { getAuditLog } from "@/server/api/audit";
import type { PageDto } from "@/server/api/types";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { outcomePresentation } from "./audit-log-presentation";

/**
 * Nesne başına tek kronolojik "Zaman çizelgesi" (koala-admin#107).
 *
 * Sayfa DTO'dan türettiği olayları verir (`TimelineBuilder`); bileşen
 * `audit.read` varsa `GET /admin/audit-log?resourceId=` ile personel
 * kararlarını ekler ve ikisini "ne zaman / kim / ne" sütunlarıyla tek
 * listede, eskiden yeniye çizer. Kullanıcı, şirket, uyuşmazlık ve atama
 * sayfaları aynı bileşeni kullanır; her biri yalnız kendi olay üreticisini
 * yazar.
 *
 * İzin politikası nesne sayfalarınınkiyle aynı: `audit.read` yoksa denetim
 * isteği çıkmaz, DTO olayları yine çizilir ve eksik yarı gerekçesiyle
 * yazılır. Denetim ucu düşerse de DTO yarısı durur — hata kutusu boş bir
 * "personel işlemi yok" cümlesinin yerine geçer, çünkü o cümle yanlış
 * okunurdu. Personel bağlantısı `staff.read`, kullanıcı bağlantısı
 * `user.read` ister; izin yoksa ad düz metin.
 *
 * Denetim yarısı yalnız en yeni {@link TIMELINE_AUDIT_ROWS} satırı ister;
 * tamamı süzgeçli denetim sayfasında. Tarihi çok eski bir DTO olayının
 * yanında hiç denetim satırı görünmemesi bu yüzden "o gün personel hiçbir
 * şey yapmadı" demek değildir; altyazı bunu söyler.
 */

export const TIMELINE_AUDIT_ROWS = 10;

type AuditResult =
  | { readonly kind: "loaded"; readonly page: PageDto<AuditEntry> }
  | { readonly kind: "failed"; readonly failure: QueueFailure }
  | { readonly kind: "no-permission" };

export interface ObjectTimelineProps {
  /** Denetim süzgecine geçen kimlik; nesnenin backend'deki kimliği. */
  resourceId: string;
  /** "Bu atama", "Bu kullanıcı" — boş ve eksik cümlelerinin öznesi. */
  subject: string;
  /** DTO'dan türeyen olaylar; sırasız gelebilir, burada sıralanır. */
  events: readonly TimelineEvent[];
  /** Başlık altına düşen, bu nesnenin denetime neyi yazdırdığını anlatan cümle. */
  children?: ReactNode;
}

export async function ObjectTimeline({
  resourceId,
  subject,
  events,
  children,
}: ObjectTimelineProps) {
  const context = await getStaffContext();
  const held = new Set<Permission>(context.staff?.permissions ?? []);
  const audit = await loadAudit(resourceId, held.has("audit.read"));

  const merged = mergeTimeline(
    events,
    audit.kind === "loaded" ? auditTimelineEvents(audit.page.content) : [],
  );

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="object-timeline-heading"
      data-testid="object-timeline"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="object-timeline-heading" className="text-sm font-semibold">
            Zaman çizelgesi
          </h2>
          <AuditSummary audit={audit} />
        </div>
        {audit.kind === "no-permission" ? null : (
          <Link
            href={auditLogForResourceHref(resourceId)}
            className="text-sm font-medium text-brand hover:underline"
            data-testid="object-timeline-audit-all"
          >
            Denetim kayıtlarını aç
          </Link>
        )}
      </div>

      {children === undefined ? null : (
        <p className="max-w-prose text-xs text-ink-muted">{children}</p>
      )}

      {audit.kind === "failed" ? (
        <QueueLoadFailure subject="Denetim izi" permission="audit.read" failure={audit.failure} />
      ) : null}

      {merged.length === 0 ? (
        <p className="text-sm text-ink-muted" data-testid="object-timeline-empty">
          {subject} için zamanı bilinen bir olay yok.
        </p>
      ) : (
        <Table caption="Zaman çizelgesi">
          <TableHead>
            <TableRow>
              <TableHeaderCell>Ne zaman</TableHeaderCell>
              <TableHeaderCell>Kim</TableHeaderCell>
              <TableHeaderCell>Ne</TableHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {merged.map((event) => (
              <TimelineRow key={event.key} event={event} held={held} />
            ))}
          </TableBody>
        </Table>
      )}

      {audit.kind === "no-permission" ? (
        <p
          className="max-w-prose text-xs text-ink-muted"
          data-testid="object-timeline-audit-disabled"
        >
          Personel kararları <code className="font-mono">audit.read</code> ister; denetim isteği
          gönderilmedi, yalnız kaydın kendi olayları çizildi.
        </p>
      ) : null}
    </section>
  );
}

async function loadAudit(resourceId: string, canReadAudit: boolean): Promise<AuditResult> {
  if (!canReadAudit) return { kind: "no-permission" };
  try {
    const page = await getAuditLog(await getKoalaAccessToken(), {
      filters: { ...NO_AUDIT_FILTERS, resourceId },
      page: 0,
      size: TIMELINE_AUDIT_ROWS,
    });
    return { kind: "loaded", page };
  } catch (error) {
    return { kind: "failed", failure: classifyQueueFailure(error) };
  }
}

function AuditSummary({ audit }: { audit: AuditResult }) {
  if (audit.kind !== "loaded") return null;
  const { totalElements, content } = audit.page;
  return (
    <p className="text-xs text-ink-muted" data-testid="object-timeline-audit-summary">
      {totalElements === 0
        ? "Bu kayıt için denetim satırı yok."
        : totalElements > content.length
          ? `Denetim izinden en yeni ${formatInteger(content.length)} satır; toplam ${formatInteger(totalElements)} kayıt.`
          : `Denetim izinden ${formatInteger(totalElements)} kayıt.`}
    </p>
  );
}

function TimelineRow({ event, held }: { event: TimelineEvent; held: ReadonlySet<Permission> }) {
  const outcome = event.allowed ? null : outcomePresentation(false);
  return (
    <TableRow
      data-testid="timeline-row"
      data-source={event.source}
      data-allowed={String(event.allowed)}
      className={
        event.allowed
          ? undefined
          : "bg-danger-soft hover:bg-danger-soft/80 border-l-4 border-l-danger"
      }
    >
      <TableCell>
        <time dateTime={event.at} className="font-mono text-xs tabular-nums text-ink-muted">
          {formatDateTimeSeconds(event.at)}
        </time>
      </TableCell>
      <TableCell>
        <Actor actor={event.actor} held={held} />
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {event.source === "audit" ? (
            <span className="font-mono text-xs">{event.label}</span>
          ) : event.href === null ? (
            <span>{event.label}</span>
          ) : (
            <Link href={event.href} className="text-brand hover:underline">
              {event.label}
            </Link>
          )}
          {event.detail === null ? null : (
            <span
              className={
                event.source === "audit" ? "font-mono text-xs text-ink-muted" : "text-ink-muted"
              }
            >
              · {event.detail}
            </span>
          )}
          {outcome === null ? null : <Badge tone={outcome.tone}>{outcome.label}</Badge>}
          <Badge tone={event.source === "audit" ? "brand" : "neutral"}>
            {event.source === "audit" ? "Personel" : "Kayıt"}
          </Badge>
        </span>
      </TableCell>
    </TableRow>
  );
}

/**
 * Personel: ad varsa ad, yoksa kısa kimlik (tam kimlik `title`'da); `/staff`
 * çapasına bağlantı yalnız `staff.read` varken. Kullanıcı: ad, `user.read`
 * varken kullanıcı sayfasına. Fail bilinmiyorsa "—".
 */
function Actor({ actor, held }: { actor: TimelineActor | null; held: ReadonlySet<Permission> }) {
  if (actor === null) return <span className="text-ink-muted">{EMPTY_VALUE}</span>;

  if (actor.kind === "user") {
    const href = held.has("user.read") ? userHrefOrNull(actor.userId) : null;
    return href === null ? (
      <span>{actor.name}</span>
    ) : (
      <Link href={href} className="text-brand hover:underline">
        {actor.name}
      </Link>
    );
  }

  const label = actor.name ?? (actor.staffId === null ? EMPTY_VALUE : shortId(actor.staffId));
  const href = auditActorHref(actor.staffId, held);
  const title = actor.staffId === null ? undefined : actor.staffId;
  return href === null ? (
    <span title={title} className={actor.name === null ? "font-mono text-xs" : undefined}>
      {label}
    </span>
  ) : (
    <Link
      href={href}
      title={title}
      className={
        actor.name === null
          ? "font-mono text-xs text-brand hover:underline"
          : "text-brand hover:underline"
      }
    >
      {label}
    </Link>
  );
}
