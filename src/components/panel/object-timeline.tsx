import Link from "next/link";
import type { ReactNode } from "react";

import { BoardingEvidenceBlock } from "@/components/panel/boarding-evidence";
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
import { EMPTY_VALUE, formatDateTime, formatInteger } from "@/lib/format";
import {
  auditTimelineEvents,
  mergeTimeline,
  type TimelineActor,
  type TimelineEvent,
} from "@/lib/object-timeline";
import { userHrefOrNull } from "@/lib/panel-href";
import { shortId } from "@/lib/short-id";
import { getAuditLog } from "@/server/api/audit";
import type { PageDto } from "@/server/api/types";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";
import { NO_STAFF_REFS, type StaffRefs } from "@/server/staff/staff-refs";

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
 * Denetim yarısı kimlik başına yalnız en yeni {@link TIMELINE_AUDIT_ROWS}
 * satırı ister; tamamı süzgeçli denetim sayfasında (`ObjectAuditPointer`). Tarihi çok eski bir DTO olayının
 * yanında hiç denetim satırı görünmemesi bu yüzden "o gün personel hiçbir
 * şey yapmadı" demek değildir; altyazı bunu söyler.
 */

export const TIMELINE_AUDIT_ROWS = 10;

interface AuditLoaded {
  readonly kind: "loaded";
  readonly entries: readonly AuditEntry[];
  readonly totalElements: number;
  /** Birden çok kimlik sorgulandıysa düşenlerin ilki; kalan sorguların satırları yine çizilir. */
  readonly failure: QueueFailure | null;
}

type AuditResult = AuditLoaded | { readonly kind: "no-permission" };

export interface ObjectTimelineProps {
  /** Denetim süzgecine geçen kimlik; nesnenin backend'deki kimliği. */
  resourceId: string;
  /**
   * Bu nesneye ait olup backend'in ayrı kimlikle yazdığı kayıtlar (örn.
   * kullanıcının silme talebi): `AuditScope.resourceIdOf` yalnız ilk yol
   * değişkenini yazar, `account-deletions/{requestId}` kararı kullanıcı
   * kimliğiyle gelmez. Her biri ayrı `resourceId` sorgusu, paralel, aynı
   * izinle; sonuç tek listede.
   */
  relatedResourceIds?: readonly string[];
  /** "Bu atama", "Bu kullanıcı" — boş ve eksik cümlelerinin öznesi. */
  subject: string;
  /** DTO'dan türeyen olaylar; sırasız gelebilir, burada sıralanır. */
  events: readonly TimelineEvent[];
  /** Başlık altına düşen, bu nesnenin denetime neyi yazdırdığını anlatan cümle. */
  children?: ReactNode;
  /**
   * DTO olaylarındaki personel kimlikleri için çözülmüş adlar (koala-admin#112):
   * sayfa `resolveStaffRefs` ile bir kez çözer, hem karar satırına hem buraya
   * verir. Denetim satırları adı zaten taşır (`actorDisplayName`); bu küme
   * yalnız `name: null` gelen aktörü tamamlar.
   */
  staffRefs?: StaffRefs;
}

/**
 * Süzgeçli denetim sayfasına giden bağlantı burada yok: nesne sayfaları onu
 * zaten `ObjectAuditPointer` ile verir, aynı adrese iki bağlantı ikinci bir
 * şey vaat ederdi.
 */
export async function ObjectTimeline({
  resourceId,
  relatedResourceIds = [],
  subject,
  events,
  children,
  staffRefs = NO_STAFF_REFS,
}: ObjectTimelineProps) {
  const context = await getStaffContext();
  const held = new Set<Permission>(context.staff?.permissions ?? []);
  const audit = await loadAudit([resourceId, ...relatedResourceIds], held.has("audit.read"));

  const merged = mergeTimeline(
    events,
    audit.kind === "loaded" ? auditTimelineEvents(audit.entries) : [],
  );

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby="object-timeline-heading"
      data-testid="object-timeline"
    >
      <div className="flex flex-col gap-0.5">
        <h2 id="object-timeline-heading" className="text-sm font-semibold">
          Zaman çizelgesi
        </h2>
        <AuditSummary audit={audit} />
      </div>

      {children === undefined ? null : (
        <p className="max-w-prose text-xs text-ink-muted">{children}</p>
      )}

      {audit.kind === "loaded" && audit.failure !== null ? (
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
              <TimelineRow key={event.key} event={event} held={held} staffRefs={staffRefs} />
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

type OneQuery =
  | { readonly ok: true; readonly page: PageDto<AuditEntry> }
  | { readonly ok: false; readonly failure: QueueFailure };

/**
 * Kimlik başına bir sorgu, paralel. Biri düşerse diğerlerinin satırları
 * durur ve düşen söylenir — tek kimliğin hatası yüzünden çizelgenin denetim
 * yarısını boşaltmak "personel hiçbir şey yapmadı" diye okunurdu. Aynı
 * satır iki sorguda gelemez (`resourceId` tek değer), yine de kimliğe göre
 * tekilleştirilir.
 */
async function loadAudit(
  resourceIds: readonly string[],
  canReadAudit: boolean,
): Promise<AuditResult> {
  if (!canReadAudit) return { kind: "no-permission" };
  const accessToken = await getKoalaAccessToken();
  const unique = [...new Set(resourceIds.filter((id) => id.length > 0))];
  const results = await Promise.all(
    unique.map(async (resourceId): Promise<OneQuery> => {
      try {
        const page = await getAuditLog(accessToken, {
          filters: { ...NO_AUDIT_FILTERS, resourceId },
          page: 0,
          size: TIMELINE_AUDIT_ROWS,
        });
        return { ok: true, page };
      } catch (error) {
        return { ok: false, failure: classifyQueueFailure(error) };
      }
    }),
  );

  const seen = new Set<string>();
  const entries: AuditEntry[] = [];
  let totalElements = 0;
  let failure: QueueFailure | null = null;
  for (const result of results) {
    if (!result.ok) {
      failure ??= result.failure;
      continue;
    }
    totalElements += result.page.totalElements;
    for (const entry of result.page.content) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      entries.push(entry);
    }
  }
  return { kind: "loaded", entries, totalElements, failure };
}

function AuditSummary({ audit }: { audit: AuditResult }) {
  if (audit.kind !== "loaded" || audit.failure !== null) return null;
  const { totalElements, entries } = audit;
  return (
    <p className="text-xs text-ink-muted" data-testid="object-timeline-audit-summary">
      {totalElements === 0
        ? "Bu kayıt için denetim satırı yok."
        : totalElements > entries.length
          ? `Denetim izinden en yeni ${formatInteger(entries.length)} satır; toplam ${formatInteger(totalElements)} kayıt.`
          : `Denetim izinden ${formatInteger(totalElements)} kayıt.`}
    </p>
  );
}

function TimelineRow({
  event,
  held,
  staffRefs,
}: {
  event: TimelineEvent;
  held: ReadonlySet<Permission>;
  staffRefs: StaffRefs;
}) {
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
          {formatDateTime(event.at)}
        </time>
      </TableCell>
      <TableCell>
        <Actor actor={event.actor} held={held} staffRefs={staffRefs} />
      </TableCell>
      <TableCell>
        <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          {event.source === "audit" ? (
            <span className="font-mono text-xs">{event.label}</span>
          ) : (
            <span>{event.label}</span>
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
        {event.boarding === undefined || event.boarding === null ? null : (
          <BoardingEvidenceBlock evidence={event.boarding} />
        )}
      </TableCell>
    </TableRow>
  );
}

/**
 * Personel: ad varsa ad, yoksa `staffRefs`'ten çözülmüş ad, o da yoksa kısa
 * kimlik (tam kimlik `title`'da); `/staff` çapasına bağlantı yalnız
 * `staff.read` varken. Kullanıcı: ad, `user.read` varken kullanıcı
 * sayfasına. Fail bilinmiyorsa "—".
 */
function Actor({
  actor,
  held,
  staffRefs,
}: {
  actor: TimelineActor | null;
  held: ReadonlySet<Permission>;
  staffRefs: StaffRefs;
}) {
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

  const resolved = actor.staffId === null ? undefined : staffRefs[actor.staffId];
  const name = actor.name ?? (resolved?.resolved ? resolved.label : null);
  const label = name ?? (actor.staffId === null ? EMPTY_VALUE : shortId(actor.staffId));
  const href = resolved?.href ?? auditActorHref(actor.staffId, held);
  const title = actor.staffId === null ? undefined : actor.staffId;
  return href === null ? (
    <span title={title} className={name === null ? "font-mono text-xs" : undefined}>
      {label}
    </span>
  ) : (
    <Link
      href={href}
      title={title}
      className={
        name === null
          ? "font-mono text-xs text-brand hover:underline"
          : "text-brand hover:underline"
      }
    >
      {label}
    </Link>
  );
}
