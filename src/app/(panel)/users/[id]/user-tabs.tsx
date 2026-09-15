import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { ObjectAuditPointer } from "@/components/panel/authz/object-audit-pointer";
import { ObjectTimeline } from "@/components/panel/object-timeline";
import { QueueLoadFailure, type QueueFailure } from "@/components/panel/queue";
import {
  Badge,
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatBoolean, formatDateTime, formatInteger } from "@/lib/format";
import { bankAccountVerificationStatusLabel } from "@/lib/iban-verification";
import { TimelineBuilder, type TimelineEvent } from "@/lib/object-timeline";
import {
  assignmentsForEmployerHref,
  assignmentsForWorkerHref,
  disputesForUserHref,
  ibanVerificationsForUserHref,
  payoutsForWorkerHref,
  reportsAboutUserHref,
  reportsByReporterHref,
  resolvedDisputesForUserHref,
  userTabHref,
} from "@/lib/panel-href";
import { USER_TABS, USER_TAB_SPECS, isTabEnabled, type UserTab } from "@/lib/user-tabs";
import { getDisputes, type Dispute } from "@/server/api/disputes";
import { ASSIGNMENT_PAGING, getAdminAssignments } from "@/server/api/escrow";
import { IBAN_PENDING_PAGING, getPendingIbanVerifications } from "@/server/api/iban-verification";
import { getMarketplaceUserRoles } from "@/server/api/marketplace-user-roles";
import {
  getUserBankAccounts,
  type AdminBankAccount,
  type AdminUserCounts,
  type MarketplaceUserDetail,
} from "@/server/api/marketplace-users";
import { firstPage } from "@/server/api/paging";
import { PAYOUT_PAGING, PAYOUT_STATUSES, getPayouts } from "@/server/api/payout-reconciliation";
import { REPORT_PAGING, getReports } from "@/server/api/reports";
import type { PageDto } from "@/server/api/types";
import { isPermission, permissionLabel, type Permission } from "@/server/authz/permissions";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { AssignmentTable } from "../../assignments/assignment-table";
import type { SummaryEntry } from "../../disputes/dispute-detail";
import { DisputeTable } from "../../disputes/dispute-table";
import { loadSummaries } from "../../disputes/load-summaries";
import { PendingIbanTable } from "../../iban-verifications/pending-table";
import { PayoutTable } from "../../payout-reconciliation/payout-table";
import { ReportTable } from "../../reports/report-table";
import { UserRoleDetail, type UserGrants } from "../user-roles";

/**
 * Kullanıcı sayfasının sekme şeridi ve sekme içerikleri (koala-admin#103).
 * Sekme tanımları `@/lib/user-tabs` — izin kuralı yalnız orada. Yalnız
 * seçili sekmenin listesi istenir; her liste ilk on satırı çizer ve süzgeçli
 * liste sayfasına "Tümünü aç" verir — süzgeç, sayfalama ve arama orada.
 *
 * İzin politikası liste sayfalarınınkiyle aynı: sekme görünür ama izin yoksa
 * bağlantı verilmez, seçilirse gerekçe yazılır ve istek çıkmaz. `denetim`
 * sekmesinin rol yarısı `user.read` ile okunur; zaman çizelgesinin denetim
 * yarısı `audit.read` ister ve yalnız o yarı kapanır (koala-admin#107).
 */

/** Sekme başına satır; toplam sayı başlıkta, kalanı "Tümünü aç" ile. */
export const INLINE_ROWS = 10;

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
      {USER_TABS.map((tab) => {
        const spec = USER_TAB_SPECS[tab];
        const total = counts === null || spec.count === null ? 0 : spec.count(counts);
        const badge =
          total > 0 ? (
            <Badge tone={tab === activeTab ? "brand" : "neutral"} className="ml-1.5">
              {formatInteger(total)}
            </Badge>
          ) : null;
        if (!isTabEnabled(tab, held)) {
          // Gerekçe pilin içinde görünür metin, `title` değil: klavye ve ekran
          // okuyucu da görsün. `tabIndex` odaklanabilsin diye; bağlantı değil.
          return (
            <span
              key={tab}
              aria-disabled="true"
              tabIndex={0}
              data-testid={`user-tab-${tab}-disabled`}
              className="inline-flex cursor-not-allowed items-baseline gap-1.5 rounded-md border border-dashed border-border-subtle px-3 py-1.5 text-sm font-medium text-ink-muted"
            >
              {spec.label}
              {badge}
              <span className="text-xs font-normal">
                · <code className="font-mono">{spec.permission}</code> gerekir
              </span>
            </span>
          );
        }
        const active = tab === activeTab;
        return (
          <Link
            key={tab}
            href={userTabHref(userId, tab)}
            aria-current={active ? "page" : undefined}
            data-testid={`user-tab-${tab}`}
            className={
              active ? "button button--primary button--sm" : "button button--secondary button--sm"
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
export function DisabledTabPanel({ tab }: { tab: UserTab }) {
  const spec = USER_TAB_SPECS[tab];
  const permission: Permission | null = spec.permission;
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      data-testid="user-tab-disabled-notice"
    >
      <h2 className="text-sm font-semibold">{spec.label}</h2>
      <p className="max-w-prose text-sm text-ink-muted">
        Bu sekme <code className="font-mono">{permission}</code> ister
        {permission !== null && isPermission(permission) ? ` (${permissionLabel(permission)})` : ""}
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
  const paging = firstPage(ASSIGNMENT_PAGING, INLINE_ROWS);
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
        permission={USER_TAB_SPECS.atamalar.permission}
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
        permission={USER_TAB_SPECS.atamalar.permission}
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
  const paging = firstPage(PAYOUT_PAGING, INLINE_ROWS);
  const result = await inline(() =>
    getPayouts(accessToken, { paging, workerId: userId, status: PAYOUT_STATUSES }),
  );

  return (
    <InlineSection
      id="payouts"
      title="Hakedişleri"
      unit="hakediş"
      permission={USER_TAB_SPECS.hakedisler.permission}
      allHref={payoutsForWorkerHref(userId)}
      result={result}
      emptyTitle="Bu kullanıcının hakedişi yok."
    >
      {(rows) => <PayoutTable rows={rows} />}
    </InlineSection>
  );
}

/**
 * Banka sekmesi (koala-admin#108). İki yarı, iki izin: hesaplar
 * `GET /admin/users/{id}/bank-accounts` (`user.read_pii`, sekmenin kendi
 * kapısı); bekleyen IBAN doğrulamaları `GET /admin/bank-account-verifications
 * ?userId=` (`bank.account.verify`) — izin yoksa o yarı gerekçesiyle kapanır
 * ve istek çıkmaz, hesaplar yine çizilir. Tam IBAN hiçbir uçta yok; maskeli
 * değer olduğu gibi yazılır. Hesap listesi sayfasız (`List`), bekleyenler
 * ilk on satır ve "Tümünü aç".
 */
export async function BankTab({
  accessToken,
  userId,
  canReadPending,
}: {
  accessToken: string;
  userId: string;
  canReadPending: boolean;
}) {
  const [accounts, pending] = await Promise.all([
    loadBankAccounts(accessToken, userId),
    canReadPending
      ? inline(() =>
          getPendingIbanVerifications(accessToken, {
            paging: firstPage(IBAN_PENDING_PAGING, INLINE_ROWS),
            userId,
          }),
        )
      : Promise.resolve(null),
  ]);

  return (
    <div className="flex flex-col gap-6">
      <section
        className="flex flex-col gap-3"
        aria-labelledby="user-bank-accounts-heading"
        data-testid="user-bank-accounts"
      >
        <div className="flex flex-col gap-0.5">
          <h2 id="user-bank-accounts-heading" className="text-sm font-semibold">
            Banka hesapları
          </h2>
          <p className="max-w-prose text-xs text-ink-muted">
            Maskeli IBAN ve etkin doğrulama durumu; tam IBAN backend&apos;den hiç gelmez. Bu okuma
            kişisel veri denetim kaydına düşer.
          </p>
        </div>
        {!accounts.ok ? (
          <QueueLoadFailure
            subject="Banka hesapları"
            permission="user.read_pii"
            failure={accounts.failure}
          />
        ) : accounts.accounts.length === 0 ? (
          <EmptyState title="Bu kullanıcının kayıtlı banka hesabı yok." />
        ) : (
          <BankAccountTable accounts={accounts.accounts} />
        )}
      </section>

      {pending === null ? (
        <section
          className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
          data-testid="user-inline-iban-pending-disabled"
        >
          <h2 className="text-sm font-semibold">Bekleyen IBAN doğrulamaları</h2>
          <p className="max-w-prose text-sm text-ink-muted">
            Bu bölüm <code className="font-mono">bank.account.verify</code> ister; liste isteği
            gönderilmedi.
          </p>
        </section>
      ) : (
        <InlineSection
          id="iban-pending"
          title="Bekleyen IBAN doğrulamaları"
          unit="doğrulama"
          permission="bank.account.verify"
          allHref={ibanVerificationsForUserHref(userId)}
          result={pending}
          emptyTitle="Bu kullanıcının bekleyen IBAN doğrulaması yok."
        >
          {(rows) => <PendingIbanTable rows={rows} showUser={false} />}
        </InlineSection>
      )}
    </div>
  );
}

type BankAccountsResult =
  { ok: true; accounts: readonly AdminBankAccount[] } | { ok: false; failure: QueueFailure };

async function loadBankAccounts(accessToken: string, userId: string): Promise<BankAccountsResult> {
  try {
    return { ok: true, accounts: await getUserBankAccounts(accessToken, userId) };
  } catch (error) {
    return { ok: false, failure: classifyQueueFailure(error) };
  }
}

const BANK_STATUS_TONES: Readonly<Record<string, "neutral" | "warning" | "success" | "danger">> = {
  UNVERIFIED: "neutral",
  PENDING: "warning",
  VERIFIED: "success",
  EXPIRED: "danger",
};

function BankAccountTable({ accounts }: { accounts: readonly AdminBankAccount[] }) {
  return (
    <Table caption="Banka hesapları">
      <TableHead>
        <TableRow>
          <TableHeaderCell>IBAN</TableHeaderCell>
          <TableHeaderCell>Doğrulama</TableHeaderCell>
          <TableHeaderCell>Birincil</TableHeaderCell>
          <TableHeaderCell>Hesap sahibi adı</TableHeaderCell>
          <TableHeaderCell>Doğrulanma</TableHeaderCell>
          <TableHeaderCell>Eklenme</TableHeaderCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {accounts.map((account) => (
          <TableRow key={account.id}>
            <TableCell>
              <span className="font-mono text-xs">{account.maskedIban}</span>
            </TableCell>
            <TableCell>
              <Badge tone={BANK_STATUS_TONES[account.verificationStatus] ?? "neutral"}>
                {bankAccountVerificationStatusLabel(account.verificationStatus)}
              </Badge>
            </TableCell>
            <TableCell>
              {account.primary ? <Badge tone="brand">Birincil</Badge> : EMPTY_VALUE}
            </TableCell>
            <TableCell>{formatBoolean(account.accountHolderNameVerified)}</TableCell>
            <TableCell>{formatDateTime(account.verifiedAt)}</TableCell>
            <TableCell>{formatDateTime(account.createdAt)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
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
        permission={USER_TAB_SPECS.uyusmazliklar.permission}
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
        permission={USER_TAB_SPECS.uyusmazliklar.permission}
        allHref={resolvedDisputesForUserHref(userId)}
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
  const paging = firstPage(REPORT_PAGING, INLINE_ROWS);
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
        permission={USER_TAB_SPECS.sikayetler.permission}
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
        permission={USER_TAB_SPECS.sikayetler.permission}
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
 * Zaman çizelgesi (koala-admin#107) kaydın kendi anlarını — hesap açılışı,
 * rozetler — personel kararlarıyla tek listede çizer; denetim yarısı
 * `ObjectTimeline` içinde yalnız `audit.read` varken istenir ve bu kaydın
 * bütün satırlarını (`resourceId`) izne süzmeden getirir; bekleyen silme
 * talebinin kimliğiyle yazılan karar ikinci sorguyla eklenir.
 */
export async function AuditTab({
  accessToken,
  user,
  canManage,
}: {
  accessToken: string;
  user: MarketplaceUserDetail;
  canManage: boolean;
}) {
  let grants: UserGrants;
  try {
    grants = { status: "ok", grants: await getMarketplaceUserRoles(accessToken, user.id) };
  } catch {
    grants = { status: "failed" };
  }

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

      <ObjectTimeline
        resourceId={user.id}
        relatedResourceIds={relatedResourceIds(user)}
        subject="Bu kullanıcı"
        events={userTimelineEvents(user)}
      >
        Kaydın kendi anları DTO&apos;dan (hesap açılışı, rozetler); rol yazımı ve bu kullanıcı
        kimliğiyle kayıtlı personel işlemleri denetim izinden. Bekleyen silme talebi ve son kimlik
        incelemesi varsa onların kimliğiyle yazılan kararlar da eklenir; kimliğini göndermeyen eski
        sunucuda kimlik incelemesi kararları burada görünmez.
      </ObjectTimeline>

      <ObjectAuditPointer resourceId={user.id} linkLabel="Bu kullanıcının denetim kayıtlarını aç">
        Rol yazımı ve kullanıcı kaydını okuma backend tarafından bu kullanıcı kimliğiyle denetim
        kaydına yazılır; personelin bu kaydı açması da kayda düşer.
      </ObjectAuditPointer>
    </div>
  );
}

/**
 * Kullanıcının DTO'dan türeyen anları. Eski sunucu `createdAt` ve rozetleri
 * göndermez; o satırlar yalnız yoklukla eksilir. Kimlik incelemesi ve silme
 * talebi tarih taşımaz, çizelgeye giremez. Backend `resourceId`'ye yalnız
 * ilk yol değişkenini yazdığı için (`AuditScope.resourceIdOf`) silme talebi
 * kararı kullanıcı kimliğiyle gelmez; `pendingDeletionRequestId` ve
 * `identityReviewId` (koala-backend#301) ikincil sorgular olarak
 * `ObjectTimeline`'a verilir.
 */
function relatedResourceIds(user: MarketplaceUserDetail): readonly string[] {
  return [user.pendingDeletionRequestId, user.identityReviewId].filter(
    (id): id is string => id !== null,
  );
}

function userTimelineEvents(user: MarketplaceUserDetail): readonly TimelineEvent[] {
  const timeline = new TimelineBuilder();
  timeline.push(user.createdAt, "Hesap oluşturuldu");
  for (const badge of user.badges ?? []) {
    timeline.push(badge.earnedAt, "Rozet kazanıldı", { detail: badge.name ?? badge.code });
  }
  return timeline.build();
}
