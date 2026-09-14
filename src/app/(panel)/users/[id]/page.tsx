import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata, Route } from "next";
import type { ReactNode } from "react";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { ProfilePicture } from "@/components/panel/profile-picture";
import { QueueLoadFailure } from "@/components/panel/queue";
import { Badge } from "@/components/ui";
import { EMPTY_VALUE, formatBoolean, formatDateTime, formatInteger } from "@/lib/format";
import {
  accountDeletionHref,
  assignmentsForEmployerHref,
  assignmentsForWorkerHref,
  companyHref,
  disputesForUserHref,
  isUuid,
  payoutsForWorkerHref,
  reportHref,
  reportsAboutUserHref,
  reportsByReporterHref,
  reportsForUserHref,
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
import { getMarketplaceUserRoles } from "@/server/api/marketplace-user-roles";
import { readPaging } from "@/server/api/paging";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import type { Permission } from "@/server/authz/permissions";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure, notFoundIfMissing } from "@/server/queue/decisions";

import { UserRoleDetail, type UserGrants } from "../user-roles";

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
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

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
        <UserObject id={id} />
      </RequirePermission>
    </div>
  );
}

async function UserObject({ id }: { id: string }) {
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

  let grants: UserGrants;
  try {
    grants = { status: "ok", grants: await getMarketplaceUserRoles(accessToken, user.id) };
  } catch {
    grants = { status: "failed" };
  }

  const openReports = canModerate ? await loadOpenReports(accessToken, user.id) : null;
  const held = new Set<Permission>(context.staff?.permissions ?? []);

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

      {user.counts === null ? null : <HistoryCounts user={user} counts={user.counts} held={held} />}

      <section className="grid gap-4 md:grid-cols-2">
        {user.companies === null ? null : (
          <Memberships companies={user.companies} canOpen={held.has("company.approve")} />
        )}
        {user.badges === null ? null : <Badges badges={user.badges} />}
      </section>

      {canModerate ? <OpenReports userId={user.id} reports={openReports} /> : null}

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
  /** Süzgeçli liste; `null` ise o sayacın listesi yok (başvuru ucu açılmadı). */
  readonly href: Route | null;
  /** Listeyi açan sayfanın kapısı; izin yoksa yalnız sayı yazılır. */
  readonly permission: Permission | null;
}

/**
 * Sekiz sayaç, süzgeçli listelere bağlantıyla. Ödemeler için ayrı bir liste
 * ucu yok; `/admin/payments` açılmadı, sayaç işveren olarak atamalara iner
 * (koala-backend PR 286). Başvuruların da listesi yok, yalnız sayı.
 *
 * Backend sayaçları her durumu sayar; hakediş ve şikayet bağlantıları bu
 * yüzden `durum=hepsi` taşır (kuyruk varsayılanları PROCESSING ve OPEN
 * olurdu, sayı ile liste tutmazdı). Uyuşmazlık ucu tek `status` alır ve
 * verilmezse yalnız bekleyenleri döner — orada "hepsi" yok, bağlantı
 * bekleyen kuyruğa gider; çözülmüşler durum sekmesinden.
 */
function countEntries(userId: string): readonly CountEntry[] {
  return [
    { key: "applications", label: "Başvurular", href: null, permission: null },
    {
      key: "assignmentsAsWorker",
      label: "Atamalar (işçi)",
      href: assignmentsForWorkerHref(userId),
      permission: "payment.read",
    },
    {
      key: "assignmentsAsEmployer",
      label: "Atamalar (işveren)",
      href: assignmentsForEmployerHref(userId),
      permission: "payment.read",
    },
    {
      key: "payments",
      label: "Ödemeler",
      href: assignmentsForEmployerHref(userId),
      permission: "payment.read",
    },
    {
      key: "payouts",
      label: "Hakedişler",
      href: payoutsForWorkerHref(userId),
      permission: "payout.reconcile",
    },
    {
      key: "disputes",
      label: "Uyuşmazlıklar",
      href: disputesForUserHref(userId),
      permission: "dispute.resolve",
    },
    {
      key: "reportsReceived",
      label: "Hakkındaki şikayetler",
      href: reportsAboutUserHref(userId),
      permission: "content.moderate",
    },
    {
      key: "reportsMade",
      label: "Açtığı şikayetler",
      href: reportsByReporterHref(userId),
      permission: "content.moderate",
    },
  ];
}

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
          Sayaçlar backend&apos;den gelir; bağlantı ilgili listeyi bu kullanıcıya süzer ve yalnız o
          listenin izni varken verilir. Ödemelerin ayrı listesi yok: işveren olarak atamalara iner.
        </p>
      </div>
      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
        {countEntries(user.id).map((entry) => {
          const canOpen =
            entry.href !== null && entry.permission !== null && held.has(entry.permission);
          return (
            <div key={entry.key} className="flex flex-col gap-0.5">
              <dt className="text-xs text-ink-muted">{entry.label}</dt>
              <dd className="text-lg font-semibold">
                {canOpen && entry.href !== null ? (
                  <Link href={entry.href} className="text-brand hover:underline">
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
