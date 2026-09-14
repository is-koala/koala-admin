import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { AuditLogTable } from "@/components/panel/audit-log-table";
import { QueueLoadFailure, type QueueFailure } from "@/components/panel/queue";
import { Badge, EmptyState } from "@/components/ui";
import { NO_AUDIT_FILTERS, type AuditEntry } from "@/lib/audit-log";
import { formatInteger } from "@/lib/format";
import {
  assignmentsForEmployerHref,
  assignmentsForWorkerHref,
  auditLogForResourceHref,
  disputesForUserHref,
  disputesHref,
  payoutsForWorkerHref,
  reportsAboutUserHref,
  reportsByReporterHref,
  userTabHref,
  type UserTab,
} from "@/lib/panel-href";
import { getAuditLog } from "@/server/api/audit";
import { getDisputes, type Dispute } from "@/server/api/disputes";
import { ASSIGNMENT_PAGING, getAdminAssignments } from "@/server/api/escrow";
import { getMarketplaceUserRoles } from "@/server/api/marketplace-user-roles";
import type { AdminUserCounts, MarketplaceUserDetail } from "@/server/api/marketplace-users";
import { readPaging } from "@/server/api/paging";
import { PAYOUT_PAGING, PAYOUT_STATUSES, getPayouts } from "@/server/api/payout-reconciliation";
import { REPORT_PAGING, getReports } from "@/server/api/reports";
import type { PageDto } from "@/server/api/types";
import { isPermission, permissionLabel, type Permission } from "@/server/authz/permissions";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { AssignmentTable } from "../../assignments/assignment-table";
import type { SummaryEntry } from "../../disputes/dispute-detail";
import { DisputeTable } from "../../disputes/dispute-table";
import { loadSummaries } from "../../disputes/load-summaries";
import { PayoutTable } from "../../payout-reconciliation/payout-table";
import { ReportTable } from "../../reports/report-table";
import { UserRoleDetail, type UserGrants } from "../user-roles";

/**
 * Kullanıcı sayfasının sekmeleri (koala-admin#103). Sekme `?sekme=` ile
 * URL'de taşınır; yalnız seçili sekmenin listesi istenir, diğerleri için
 * backend'e gidilmez. Her liste ilk on satırı çizer ve süzgeçli liste
 * sayfasına "Tümünü aç" verir — süzgeç, sayfalama ve arama orada.
 *
 * İzin politikası liste sayfalarınınkiyle aynı: sekme görünür ama izin yoksa
 * bağlantı verilmez, seçilirse gerekçe yazılır ve istek çıkmaz. `denetim`
 * sekmesinin rol yarısı `user.read` ile okunur; denetim izi yarısı
 * `audit.read` ister ve yalnız o yarı kapanır.
 */

/** Sekme başına satır; toplam sayı başlıkta, kalanı "Tümünü aç" ile. */
export const INLINE_ROWS = 10;

export interface UserTabSpec {
  readonly key: UserTab;
  readonly label: string;
  /** Sekmenin listesini açan izin; `null` ise `user.read` yeter. */
  readonly permission: Permission | null;
  /** Backend sayaçlarından sekme rozetine giden toplam. */
  readonly count: (counts: AdminUserCounts) => number;
}

export const USER_TAB_SPECS: readonly UserTabSpec[] = [
  { key: "genel", label: "Genel", permission: null, count: () => 0 },
  {
    key: "atamalar",
    label: "Atamalar",
    permission: "payment.read",
    count: (counts) => counts.assignmentsAsWorker + counts.assignmentsAsEmployer,
  },
  {
    key: "hakedisler",
    label: "Hakedişler",
    permission: "payout.reconcile",
    count: (counts) => counts.payouts,
  },
  {
    key: "uyusmazliklar",
    label: "Uyuşmazlıklar",
    permission: "dispute.resolve",
    count: (counts) => counts.disputes,
  },
  {
    key: "sikayetler",
    label: "Şikayetler",
    permission: "content.moderate",
    count: (counts) => counts.reportsReceived + counts.reportsMade,
  },
  { key: "denetim", label: "Rol / Denetim", permission: null, count: () => 0 },
];

export function userTabSpec(tab: UserTab): UserTabSpec {
  const spec = USER_TAB_SPECS.find((entry) => entry.key === tab);
  /* v8 ignore next -- `USER_TABS` ve `USER_TAB_SPECS` aynı anahtar kümesini taşır. */
  if (spec === undefined) throw new Error(`Bilinmeyen kullanıcı sekmesi: ${tab}`);
  return spec;
}

export function isTabEnabled(spec: UserTabSpec, held: ReadonlySet<Permission>): boolean {
  return spec.permission === null || held.has(spec.permission);
}

export function UserTabNav({
  userId,
  activeTab,
  held,
  counts,
}: {
  userId: string;
  activeTab: UserTab;
  held: ReadonlySet<Permission>;
  counts: AdminUserCounts | null;
}) {
  return (
    <nav
      className="flex flex-wrap gap-2 border-b border-border-subtle pb-2"
      aria-label="Kullanıcı sekmeleri"
      data-testid="user-tabs"
    >
      {USER_TAB_SPECS.map((spec) => {
        const enabled = isTabEnabled(spec, held);
        const total = counts === null ? 0 : spec.count(counts);
        const badge =
          total > 0 ? (
            <Badge tone={spec.key === activeTab ? "brand" : "neutral"} className="ml-1.5">
              {formatInteger(total)}
            </Badge>
          ) : null;
        if (!enabled) {
          return (
            <span
              key={spec.key}
              aria-disabled="true"
              data-testid={`user-tab-${spec.key}-disabled`}
              title={`${spec.permission ?? ""} izni ister`}
              className="cursor-not-allowed rounded-md border border-dashed border-border-subtle px-3 py-1.5 text-sm font-medium text-ink-muted"
            >
              {spec.label}
              {badge}
            </span>
          );
        }
        const active = spec.key === activeTab;
        return (
          <Link
            key={spec.key}
            href={userTabHref(userId, spec.key)}
            aria-current={active ? "page" : undefined}
            data-testid={`user-tab-${spec.key}`}
            className={
              active
                ? "rounded-md bg-brand px-3 py-1.5 text-sm font-medium text-white"
                : "rounded-md border border-border-subtle px-3 py-1.5 text-sm font-medium text-ink hover:bg-surface-sunken"
            }
          >
            {spec.label}
            {badge}
          </Link>
        );
      })}
    </nav>
  );
}

/** Seçili sekmenin izni yok: gerekçe, istek yok. */
export function DisabledTabPanel({ spec }: { spec: UserTabSpec }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      data-testid="user-tab-disabled-notice"
    >
      <h2 className="text-sm font-semibold">{spec.label}</h2>
      <p className="max-w-prose text-sm text-ink-muted">
        Bu sekme <code className="font-mono">{spec.permission}</code> ister
        {spec.permission !== null && isPermission(spec.permission)
          ? ` (${permissionLabel(spec.permission)})`
          : ""}
        ; liste isteği gönderilmedi. Yetki kararını backend verir, panel yalnız gereksiz isteği
        önler.
      </p>
    </section>
  );
}

type InlineResult<T> = { ok: true; page: PageDto<T> } | { ok: false; failure: QueueFailure };

async function inline<T>(load: () => Promise<PageDto<T>>): Promise<InlineResult<T>> {
  try {
    return { ok: true, page: await load() };
  } catch (error) {
    return { ok: false, failure: classifyQueueFailure(error) };
  }
}

/**
 * Bir sekme bölümü: başlık, "Tümünü aç", ilk on satır ya da boş/hata durumu.
 * Boş ve yüklenemedi ayrı: boş tablo "kayıt yok" diye okunur, o yüzden hata
 * `QueueLoadFailure` ile backend'in cevabıyla çizilir.
 */
function InlineSection<T>({
  id,
  title,
  unit,
  permission,
  allHref,
  result,
  emptyTitle,
  children,
}: {
  id: string;
  title: string;
  unit: string;
  permission: Permission;
  allHref: Route;
  result: InlineResult<T>;
  emptyTitle: string;
  children: (rows: readonly T[]) => ReactNode;
}) {
  const headingId = `${id}-heading`;
  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby={headingId}
      data-testid={`user-inline-${id}`}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex flex-col gap-0.5">
          <h2 id={headingId} className="text-sm font-semibold">
            {title}
          </h2>
          {result.ok ? (
            <p className="text-xs text-ink-muted">
              {result.page.totalElements === 0
                ? `Kayıt yok.`
                : result.page.totalElements > result.page.content.length
                  ? `Toplam ${formatInteger(result.page.totalElements)} ${unit}; ilk ${formatInteger(result.page.content.length)} satır.`
                  : `Toplam ${formatInteger(result.page.totalElements)} ${unit}.`}
            </p>
          ) : null}
        </div>
        <Link
          href={allHref}
          className="text-sm font-medium text-brand hover:underline"
          data-testid={`user-inline-${id}-all`}
        >
          Tümünü aç
        </Link>
      </div>
      {!result.ok ? (
        <QueueLoadFailure subject={title} permission={permission} failure={result.failure} />
      ) : result.page.content.length === 0 ? (
        <EmptyState title={emptyTitle} />
      ) : (
        children(result.page.content)
      )}
    </section>
  );
}

export async function AssignmentsTab({
  accessToken,
  userId,
}: {
  accessToken: string;
  userId: string;
}) {
  const paging = readPaging({ boyut: String(INLINE_ROWS) }, ASSIGNMENT_PAGING);
  const [asWorker, asEmployer] = await Promise.all([
    inline(() => getAdminAssignments(accessToken, { paging, workerId: userId })),
    inline(() => getAdminAssignments(accessToken, { paging, employerId: userId })),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <InlineSection
        id="assignments-worker"
        title="İşçi olarak atamaları"
        unit="atama"
        permission="payment.read"
        allHref={assignmentsForWorkerHref(userId)}
        result={asWorker}
        emptyTitle="Bu kullanıcının işçi olarak ataması yok."
      >
        {(rows) => <AssignmentTable rows={rows} caption="İşçi olarak atamalar" />}
      </InlineSection>
      <InlineSection
        id="assignments-employer"
        title="İşveren olarak atamaları"
        unit="atama"
        permission="payment.read"
        allHref={assignmentsForEmployerHref(userId)}
        result={asEmployer}
        emptyTitle="Bu kullanıcının işveren olarak ataması yok."
      >
        {(rows) => <AssignmentTable rows={rows} caption="İşveren olarak atamalar" />}
      </InlineSection>
      <p className="max-w-prose text-xs text-ink-muted">
        Ödemelerin ayrı listesi yok; işveren olarak atamaların her biri kendi ödemesini taşır.
      </p>
    </div>
  );
}

/**
 * Sayaç her durumu sayar; liste de her durumu ister (`status=` dört durum),
 * yoksa backend yalnız PROCESSING dönerdi ve rozetle liste tutmazdı.
 */
export async function PayoutsTab({ accessToken, userId }: { accessToken: string; userId: string }) {
  const paging = readPaging({ boyut: String(INLINE_ROWS) }, PAYOUT_PAGING);
  const result = await inline(() =>
    getPayouts(accessToken, { paging, workerId: userId, status: PAYOUT_STATUSES }),
  );

  return (
    <InlineSection
      id="payouts"
      title="Hakedişleri"
      unit="hakediş"
      permission="payout.reconcile"
      allHref={payoutsForWorkerHref(userId)}
      result={result}
      emptyTitle="Bu kullanıcının hakedişi yok."
    >
      {(rows) => <PayoutTable rows={rows} />}
    </InlineSection>
  );
}

/**
 * Uyuşmazlık ucu tek `status` alır ve verilmezse bekleyenleri (OPEN,
 * UNDER_REVIEW) döner; "hepsi" yok. Bekleyen ve çözülmüş iki ayrı bölüm.
 * Tutarlar atama özetinden gelir ve `payment.read` ister; izin yoksa sütun
 * "—" kalır, tablo yine çizilir.
 */
export async function DisputesTab({
  accessToken,
  userId,
  canReadSummaries,
}: {
  accessToken: string;
  userId: string;
  canReadSummaries: boolean;
}) {
  const [pending, resolved] = await Promise.all([
    inline(() => getDisputes(accessToken, { page: 0, size: INLINE_ROWS, userId })),
    inline(() =>
      getDisputes(accessToken, { page: 0, size: INLINE_ROWS, userId, status: "RESOLVED" }),
    ),
  ]);

  const loaded: Dispute[] = [
    ...(pending.ok ? pending.page.content : []),
    ...(resolved.ok ? resolved.page.content : []),
  ];
  const summaries: ReadonlyMap<string, SummaryEntry> =
    canReadSummaries && loaded.length > 0
      ? await loadSummaries(accessToken, loaded)
      : new Map<string, SummaryEntry>();

  return (
    <div className="flex flex-col gap-6">
      <InlineSection
        id="disputes-pending"
        title="Bekleyen uyuşmazlıkları"
        unit="uyuşmazlık"
        permission="dispute.resolve"
        allHref={disputesForUserHref(userId)}
        result={pending}
        emptyTitle="Bu kullanıcının bekleyen uyuşmazlığı yok."
      >
        {(rows) => (
          <DisputeTable disputes={rows} summaries={summaries} caption="Bekleyen uyuşmazlıklar" />
        )}
      </InlineSection>
      <InlineSection
        id="disputes-resolved"
        title="Çözülmüş uyuşmazlıkları"
        unit="uyuşmazlık"
        permission="dispute.resolve"
        allHref={disputesHref({ kullanici: userId, durum: "RESOLVED" })}
        result={resolved}
        emptyTitle="Bu kullanıcının çözülmüş uyuşmazlığı yok."
      >
        {(rows) => (
          <DisputeTable disputes={rows} summaries={summaries} caption="Çözülmüş uyuşmazlıklar" />
        )}
      </InlineSection>
      {!canReadSummaries ? (
        <p className="max-w-prose text-xs text-ink-muted">
          Emanetteki tutar <code className="font-mono">payment.read</code> ister; sütun boş
          bırakıldı, özet isteği gönderilmedi.
        </p>
      ) : null}
    </div>
  );
}

/** Hakkındaki (`reportedUserId`) ve açtığı (`reporterId`) şikayetler, her durumda. */
export async function ReportsTab({ accessToken, userId }: { accessToken: string; userId: string }) {
  const paging = readPaging({ boyut: String(INLINE_ROWS) }, REPORT_PAGING);
  const [about, made] = await Promise.all([
    inline(() => getReports(accessToken, { status: null, reportedUserId: userId, paging })),
    inline(() => getReports(accessToken, { status: null, reporterId: userId, paging })),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <InlineSection
        id="reports-about"
        title="Hakkındaki şikayetler"
        unit="şikayet"
        permission="content.moderate"
        allHref={reportsAboutUserHref(userId)}
        result={about}
        emptyTitle="Bu kullanıcı hakkında şikayet yok."
      >
        {(rows) => <ReportTable reports={rows} caption="Hakkındaki şikayetler" />}
      </InlineSection>
      <InlineSection
        id="reports-made"
        title="Açtığı şikayetler"
        unit="şikayet"
        permission="content.moderate"
        allHref={reportsByReporterHref(userId)}
        result={made}
        emptyTitle="Bu kullanıcı şikayet açmamış."
      >
        {(rows) => <ReportTable reports={rows} caption="Açtığı şikayetler" />}
      </InlineSection>
    </div>
  );
}

/**
 * Rol yarısı `user.read` ile okunur, yazma formları `user.role.manage` ile.
 * Denetim izi yarısı yalnız `audit.read` varken istenir: bu kaydın bütün
 * satırları (`resourceId`), izne süzmeden — bir kullanıcıya rol yazımı da
 * silme talebi kararı da düşer.
 */
export async function AuditTab({
  accessToken,
  user,
  canManage,
  canReadAudit,
}: {
  accessToken: string;
  user: MarketplaceUserDetail;
  canManage: boolean;
  canReadAudit: boolean;
}) {
  let grants: UserGrants;
  try {
    grants = { status: "ok", grants: await getMarketplaceUserRoles(accessToken, user.id) };
  } catch {
    grants = { status: "failed" };
  }

  const audit = canReadAudit
    ? await inline(() =>
        getAuditLog(accessToken, {
          filters: { ...NO_AUDIT_FILTERS, resourceId: user.id },
          page: 0,
          size: INLINE_ROWS,
        }),
      )
    : null;

  return (
    <div className="flex flex-col gap-6">
      <UserRoleDetail user={user} grants={grants} canManage={canManage} />

      {canManage ? (
        <AuditPointer
          permission="user.role.manage"
          resourceId={user.id}
          linkLabel="Kullanıcı rol kayıtlarını aç"
        >
          Backend başarılı vermeyi user.role.grant, geri almayı user.role.revoke adıyla kaydeder.
          Personel üyelik yazımlarından ayrı izin — staff.manage bu uçları açmaz.
        </AuditPointer>
      ) : null}

      {audit === null ? (
        <section
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
          data-testid="user-inline-audit-disabled"
        >
          <h2 className="text-sm font-semibold">Denetim izi</h2>
          <p className="max-w-prose text-sm text-ink-muted">
            Bu kaydın denetim satırları <code className="font-mono">audit.read</code> ister; istek
            gönderilmedi.
          </p>
        </section>
      ) : (
        <InlineSection
          id="audit"
          title="Denetim izi"
          unit="kayıt"
          permission="audit.read"
          allHref={auditLogForResourceHref(user.id)}
          result={audit}
          emptyTitle="Bu kullanıcı için kaydedilmiş personel işlemi yok."
        >
          {(rows) => (
            <AuditLogTable entries={rows} permissionLabels={auditPermissionLabels(rows)} />
          )}
        </InlineSection>
      )}
    </div>
  );
}

/** Denetim tablosu Client Component; izin etiketleri sunucuda çözülür. */
function auditPermissionLabels(entries: readonly AuditEntry[]): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const entry of entries) {
    if (isPermission(entry.permission))
      labels[entry.permission] = permissionLabel(entry.permission);
  }
  return labels;
}
