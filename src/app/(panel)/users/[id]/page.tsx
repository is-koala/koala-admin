import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import type { ReactNode } from "react";

import { PageHeader } from "@/components/panel/page-header";
import { ProfilePicture } from "@/components/panel/profile-picture";
import { QueueLoadFailure } from "@/components/panel/queue";
import { Badge } from "@/components/ui";
import { EMPTY_VALUE, formatBoolean, formatDateTime, formatInteger } from "@/lib/format";
import {
  USER_TABS,
  USER_TAB_PARAM,
  accountDeletionHref,
  companyHref,
  isUuid,
  reportHref,
  reportsForUserHref,
  userTabHref,
  type UserTab,
} from "@/lib/panel-href";
import { getReports, REPORT_PAGING, reportReasonLabel, type Report } from "@/server/api/reports";
import {
  badgeFamilyLabel,
  badgeTierLabel,
  companyContactRoleLabel,
  getMarketplaceUser,
  identityReviewStatusLabel,
  type AdminUserBadge,
  type AdminUserCompany,
  type AdminUserCounts,
  type MarketplaceUserDetail,
} from "@/server/api/marketplace-users";
import { readEnumParam, readPaging, type SearchParams } from "@/server/api/paging";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import {
  AssignmentsTab,
  AuditTab,
  DisabledTabPanel,
  DisputesTab,
  PayoutsTab,
  ReportsTab,
  UserTabNav,
  isTabEnabled,
  userTabSpec,
} from "./user-tabs";

export const metadata: Metadata = { title: "Kullanıcı" };

/**
 * Pazaryeri kullanıcı nesnesi (koala-admin#84, #100). `GET /admin/users/{id}`
 * koala-backend#283 ile `AdminUserDetailDto` döner: iletişim, doğrulama
 * bayrakları, üyelikler, rozetler, geçmiş sayaçları, kimlik inceleme durumu
 * ve bekleyen silme talebi. Eski sunucu bunları göndermez; şema hepsini
 * isteğe bağlı okur ve sayfa bölümü gizler ya da "—" yazar.
 *
 * E-posta ve telefon iki kilit ardındadır: backend yalnız `user.read_pii`
 * taşıyan aktöre doldurur, panel de satırı yalnız o izin varken çizer —
 * izinsiz kişide `null` gelen bir alanın "—" olarak görünmesi "bu kişinin
 * e-postası yok" diye okunurdu. Açık şikayetler yalnız `content.moderate`
 * varken okunur. Kapı `user.read`: izni olmayan kişide GET hiç çıkmaz.
 *
 * Kimlik kartlarının altı sekmeli (koala-admin#103): `?sekme=` ile
 * `genel | atamalar | hakedisler | uyusmazliklar | sikayetler | denetim`.
 * Yalnız seçili sekmenin listesi istenir; sekme tanımları `user-tabs.tsx`.
 */
export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<SearchParams>;
}) {
  const { id } = await params;
  const query = searchParams === undefined ? {} : await searchParams;
  const tab = readEnumParam<UserTab>(query, USER_TAB_PARAM, USER_TABS, "genel");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kullanıcı"
        description={
          <>
            Kimlik, üyelikler, rozetler ve geçmiş; e-posta ile telefon yalnız kişisel veri izniyle.
            Askıya alma yoktur.{" "}
            <Link href={"/users" as Route} className="text-brand hover:underline">
              Dizinine dön
            </Link>
          </>
        }
      />

      <RequirePermission permission="user.read">
        <UserObject id={id} tab={tab} />
      </RequirePermission>
    </div>
  );
}

async function UserObject({ id, tab }: { id: string; tab: UserTab }) {
  // UUID olmayan bir kimlik hiçbir kaydı adresleyemez: backend'e sormadan
  // 404. Backend'in "yok" dediği kayıt da aynı yüzeye gider (koala-admin#85).
  if (!isUuid(id)) notFound();

  const accessToken = await getKoalaAccessToken();
  const context = await getStaffContext();
  const canManage = context.has("user.role.manage");
  const canModerate = context.has("content.moderate");
  const canReadPii = context.has("user.read_pii");

  let user: MarketplaceUserDetail;
  try {
    user = await getMarketplaceUser(accessToken, id);
  } catch (error) {
    notFoundIfMissing(error);
    return (
      <QueueLoadFailure
        subject="Kullanıcı detayı"
        permission="user.read"
        failure={classifyQueueFailure(error)}
      />
    );
  }

  const held = new Set<Permission>(context.staff?.permissions ?? []);
  const spec = userTabSpec(tab);
  const enabled = isTabEnabled(spec, held);

  return (
    <div className="flex flex-col gap-4">
      <section className="grid gap-4 md:grid-cols-2">
        <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border-subtle bg-surface px-4 py-4 sm:grid-cols-[10rem_1fr]">
          <dt className="text-sm text-ink-muted">Kimlik</dt>
          <dd className="font-mono text-sm break-all">{user.id}</dd>
          <dt className="text-sm text-ink-muted">Ad</dt>
          <dd className="text-sm">{safeUserName(user)}</dd>
          <dt className="text-sm text-ink-muted">Kullanıcı adı</dt>
          <dd className="text-sm">{user.username ?? EMPTY_VALUE}</dd>
          <dt className="text-sm text-ink-muted">Profil fotoğrafı</dt>
          <dd className="text-sm">
            <ProfilePicture url={user.profilePictureUrl} name={safeUserName(user)} />
          </dd>
          <dt className="text-sm text-ink-muted">Kayıt</dt>
          <dd className="text-sm">{formatDateTime(user.createdAt)}</dd>
          <dt className="text-sm text-ink-muted">İşveren</dt>
          <dd className="text-sm">{formatBoolean(user.isEmployer)}</dd>
        </dl>

        <div className="flex flex-col gap-4">
          <ContactCard user={user} canReadPii={canReadPii} />
          <VerificationCard user={user} canOpenDeletion={canReadPii} />
        </div>
      </section>

      <UserTabNav userId={user.id} activeTab={tab} held={held} counts={user.counts} />

      {!enabled ? (
        <DisabledTabPanel spec={spec} />
      ) : tab === "genel" ? (
        <GeneralTab user={user} held={held} accessToken={accessToken} canModerate={canModerate} />
      ) : tab === "atamalar" ? (
        <AssignmentsTab accessToken={accessToken} userId={user.id} />
      ) : tab === "hakedisler" ? (
        <PayoutsTab accessToken={accessToken} userId={user.id} />
      ) : tab === "uyusmazliklar" ? (
        <DisputesTab
          accessToken={accessToken}
          userId={user.id}
          canReadSummaries={held.has("payment.read")}
        />
      ) : tab === "sikayetler" ? (
        <ReportsTab accessToken={accessToken} userId={user.id} />
      ) : (
        <AuditTab
          accessToken={accessToken}
          user={user}
          canManage={canManage}
          canReadAudit={held.has("audit.read")}
        />
      )}
    </div>
  );
}

/** Sayaçlar, üyelikler, rozetler ve moderasyon bağlamı için açık şikayetler. */
async function GeneralTab({
  user,
  held,
  accessToken,
  canModerate,
}: {
  user: MarketplaceUserDetail;
  held: ReadonlySet<Permission>;
  accessToken: string;
  canModerate: boolean;
}) {
  const openReports = canModerate ? await loadOpenReports(accessToken, user.id) : null;

  return (
    <div className="flex flex-col gap-4">
      {user.counts === null ? null : <HistoryCounts user={user} counts={user.counts} held={held} />}

      {user.companies === null && user.badges === null ? null : (
        <section className="grid gap-4 md:grid-cols-2">
          {user.companies === null ? null : (
            <Memberships companies={user.companies} canOpen={held.has("company.approve")} />
          )}
          {user.badges === null ? null : <Badges badges={user.badges} />}
        </section>
      )}

      {canModerate ? <OpenReports userId={user.id} reports={openReports} /> : null}
    </div>
  );
}

/**
 * E-posta ve telefon. Satırlar yalnız `user.read_pii` varken çizilir; izin
 * varken alan yine `null` ise sunucu eski sürümdür ya da kullanıcının o
 * bilgisi yoktur — ikisi de "—".
 */
function ContactCard({ user, canReadPii }: { user: MarketplaceUserDetail; canReadPii: boolean }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="user-contact-heading"
    >
      <h2 id="user-contact-heading" className="text-sm font-semibold">
        İletişim
      </h2>
      {canReadPii ? (
        <dl className="flex flex-col gap-2 text-sm" data-testid="user-contact">
          <Row
            label="E-posta"
            value={
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span className="break-all">{user.email ?? EMPTY_VALUE}</span>
                <VerifiedBadge verified={user.emailVerified} />
              </span>
            }
          />
          <Row
            label="Telefon"
            value={
              <span className="flex flex-wrap items-center justify-end gap-2">
                <span>{user.phoneNumber ?? EMPTY_VALUE}</span>
                <VerifiedBadge verified={user.phoneVerified} />
              </span>
            }
          />
        </dl>
      ) : (
        <p className="text-sm text-ink-muted" data-testid="user-contact-hidden">
          E-posta ve telefon <code className="font-mono">user.read_pii</code> ister; backend bu izin
          olmadan alanları boş döner, panel de satırı çizmez.
        </p>
      )}
    </section>
  );
}

function VerificationCard({
  user,
  canOpenDeletion,
}: {
  user: MarketplaceUserDetail;
  canOpenDeletion: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="user-verification-heading"
    >
      <h2 id="user-verification-heading" className="text-sm font-semibold">
        Doğrulama
      </h2>
      <dl className="flex flex-col gap-2 text-sm">
        <Row label="E-posta doğrulandı" value={formatBoolean(user.emailVerified)} />
        <Row label="Telefon doğrulandı" value={formatBoolean(user.phoneVerified)} />
        <Row label="Kimlik doğrulandı" value={formatBoolean(user.identityVerified)} />
        <Row
          label="Kimlik incelemesi"
          value={
            user.identityReviewStatus === null
              ? EMPTY_VALUE
              : identityReviewStatusLabel(user.identityReviewStatus)
          }
        />
        <Row
          label="Silme talebi"
          value={
            user.pendingDeletionRequestId === null ? (
              <span className="text-ink-muted">Bekleyen talep yok</span>
            ) : canOpenDeletion ? (
              <Link
                href={accountDeletionHref(user.pendingDeletionRequestId)}
                className="font-mono text-xs text-brand hover:underline"
              >
                {user.pendingDeletionRequestId}
              </Link>
            ) : (
              <span className="font-mono text-xs">{user.pendingDeletionRequestId}</span>
            )
          }
        />
      </dl>
    </section>
  );
}

interface CountEntry {
  readonly key: keyof AdminUserCounts;
  readonly label: string;
  /** Sayacın açıldığı sekme; `null` ise o sayacın listesi yok (başvuru ucu açılmadı). */
  readonly tab: UserTab | null;
  /** Sekmenin listesini açan izin; izin yoksa yalnız sayı yazılır. */
  readonly permission: Permission | null;
}

/**
 * Sekiz sayaç. Bağlantı artık sayfadan çıkmaz: ilgili sekmeyi açar
 * (koala-admin#103), süzgeçli tam liste sekmedeki "Tümünü aç" ile. Ödemeler
 * için ayrı bir liste ucu yok; `/admin/payments` açılmadı, sayaç işveren
 * olarak atamalara iner (koala-backend PR 286). Başvuruların da listesi yok,
 * yalnız sayı.
 */
const COUNT_ENTRIES: readonly CountEntry[] = [
  { key: "applications", label: "Başvurular", tab: null, permission: null },
  {
    key: "assignmentsAsWorker",
    label: "Atamalar (işçi)",
    tab: "atamalar",
    permission: "payment.read",
  },
  {
    key: "assignmentsAsEmployer",
    label: "Atamalar (işveren)",
    tab: "atamalar",
    permission: "payment.read",
  },
  { key: "payments", label: "Ödemeler", tab: "atamalar", permission: "payment.read" },
  { key: "payouts", label: "Hakedişler", tab: "hakedisler", permission: "payout.reconcile" },
  { key: "disputes", label: "Uyuşmazlıklar", tab: "uyusmazliklar", permission: "dispute.resolve" },
  {
    key: "reportsReceived",
    label: "Hakkındaki şikayetler",
    tab: "sikayetler",
    permission: "content.moderate",
  },
  {
    key: "reportsMade",
    label: "Açtığı şikayetler",
    tab: "sikayetler",
    permission: "content.moderate",
  },
];

function HistoryCounts({
  user,
  counts,
  held,
}: {
  user: MarketplaceUserDetail;
  counts: AdminUserCounts;
  held: ReadonlySet<Permission>;
}) {
  return (
    <section
      className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="user-history-heading"
      data-testid="user-history"
    >
      <div className="flex flex-col gap-1">
        <h2 id="user-history-heading" className="text-sm font-semibold">
          Geçmiş
        </h2>
        <p className="max-w-prose text-xs text-ink-muted">
          Sayaçlar backend&apos;den gelir; bağlantı ilgili sekmeyi bu sayfada açar ve yalnız o
          listenin izni varken verilir. Ödemelerin ayrı listesi yok: işveren olarak atamalara iner.
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {COUNT_ENTRIES.map((entry) => {
          const canOpen =
            entry.tab !== null && entry.permission !== null && held.has(entry.permission);
          return (
            <div key={entry.key} className="flex flex-col gap-0.5">
              <dt className="text-xs text-ink-muted">{entry.label}</dt>
              <dd className="text-lg font-semibold">
                {canOpen && entry.tab !== null ? (
                  <Link
                    href={userTabHref(user.id, entry.tab)}
                    className="text-brand hover:underline"
                  >
                    {formatInteger(counts[entry.key])}
                  </Link>
                ) : (
                  formatInteger(counts[entry.key])
                )}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}

function Memberships({
  companies,
  canOpen,
}: {
  companies: readonly AdminUserCompany[];
  canOpen: boolean;
}) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="user-companies-heading"
      data-testid="user-companies"
    >
      <h2 id="user-companies-heading" className="text-sm font-semibold">
        Üyelikler
      </h2>
      {companies.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu kullanıcı hiçbir şirkette yetkili değil.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {companies.map((company) => (
            <li key={company.id} className="flex flex-wrap items-baseline gap-x-2">
              {canOpen ? (
                <Link href={companyHref(company.id)} className="text-brand hover:underline">
                  {company.name ?? company.id}
                </Link>
              ) : (
                <span>{company.name ?? company.id}</span>
              )}
              <span className="text-ink-muted">{companyContactRoleLabel(company.role)}</span>
            </li>
          ))}
        </ul>
      )}
      {companies.length > 0 && !canOpen ? (
        <p className="text-xs text-ink-muted">
          Şirket sayfası <code className="font-mono">company.approve</code> ister; bağlantı
          verilmedi.
        </p>
      ) : null}
    </section>
  );
}

function Badges({ badges }: { badges: readonly AdminUserBadge[] }) {
  return (
    <section
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface p-4"
      aria-labelledby="user-badges-heading"
      data-testid="user-badges"
    >
      <h2 id="user-badges-heading" className="text-sm font-semibold">
        Rozetler
      </h2>
      {badges.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu kullanıcı henüz rozet kazanmamış.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {badges.map((badge) => {
            const meta = [badgeFamilyLabel(badge.family), badgeTierLabel(badge.tier)].filter(
              (part): part is string => part !== null,
            );
            return (
              <li key={badge.code} className="flex flex-wrap items-baseline gap-x-2">
                <span className="font-medium">{badge.name ?? badge.code}</span>
                {meta.length === 0 ? null : (
                  <span className="text-ink-muted">{meta.join(" · ")}</span>
                )}
                <span className="text-xs text-ink-muted">{formatDateTime(badge.earnedAt)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function VerifiedBadge({ verified }: { verified: boolean | null }) {
  if (verified === null) return null;
  return verified ? (
    <Badge tone="success">Doğrulandı</Badge>
  ) : (
    <Badge tone="warning">Doğrulanmadı</Badge>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2">
      <dt className="text-ink-muted">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}

async function loadOpenReports(
  accessToken: string,
  userId: string,
): Promise<{ ok: true; reports: readonly Report[] } | { ok: false }> {
  try {
    const page = await getReports(accessToken, {
      status: "OPEN",
      reportedUserId: userId,
      paging: readPaging({}, REPORT_PAGING),
    });
    return { ok: true, reports: page.content };
  } catch {
    return { ok: false };
  }
}

function OpenReports({
  userId,
  reports,
}: {
  userId: string;
  reports: { ok: true; reports: readonly Report[] } | { ok: false } | null;
}) {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      <h2 className="text-sm font-semibold">Açık şikayetler</h2>
      {reports === null || !reports.ok ? (
        <p className="text-sm text-ink-muted">Açık şikayetler okunamadı.</p>
      ) : reports.reports.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu kullanıcı hakkında açık şikayet yok.</p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {reports.reports.map((report) => (
            <li key={report.id}>
              <Link href={reportHref(report.id)} className="text-brand hover:underline">
                {reportReasonLabel(report.reason)}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="text-sm">
        <Link href={reportsForUserHref(userId)} className="text-brand hover:underline">
          Bu kullanıcının şikayetleri
        </Link>
      </p>
    </section>
  );
}
