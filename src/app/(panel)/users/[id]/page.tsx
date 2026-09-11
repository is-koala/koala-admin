import Link from "next/link";
import type { Metadata, Route } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { EMPTY_VALUE } from "@/lib/format";
import { isUuid, reportHref, reportsForUserHref } from "@/lib/panel-href";
import { getReports, REPORT_PAGING, reportReasonLabel, type Report } from "@/server/api/reports";
import { getMarketplaceUser } from "@/server/api/marketplace-users";
import { getMarketplaceUserRoles } from "@/server/api/marketplace-user-roles";
import { readPaging } from "@/server/api/paging";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { UserRoleDetail, type UserGrants } from "../user-roles";

export const metadata: Metadata = { title: "Kullanıcı" };

/**
 * Pazaryeri kullanıcı nesnesi. SafeUser + roller; askıya alma yoktur.
 * Açık şikayetler yalnız `content.moderate` varken okunur — o uç başka izin
 * istemez ve panel uydurma bir kimlik/şirket durumu çizmez.
 * Kapı `user.read`: izni olmayan kişide GET /admin/users/{id} çıkmaz.
 */
export default async function UserDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kullanıcı"
        description={
          <>
            E-posta bu projeksiyonda yoktur. Askıya alma yoktur.{" "}
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
  if (!isUuid(id)) {
    return (
      <p className="text-sm text-ink-muted">Kullanıcı kimliği geçersiz. Dizinden bir satır açın.</p>
    );
  }

  const accessToken = await getKoalaAccessToken();
  const context = await getStaffContext();
  const canManage = context.has("user.role.manage");
  const canModerate = context.has("content.moderate");

  let user;
  try {
    user = await getMarketplaceUser(accessToken, id);
  } catch (error) {
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

  return (
    <div className="flex flex-col gap-4">
      <dl className="grid gap-x-6 gap-y-2 rounded-lg border border-border-subtle bg-surface px-4 py-4 sm:grid-cols-[10rem_1fr]">
        <dt className="text-sm text-ink-muted">Kimlik</dt>
        <dd className="font-mono text-sm break-all">{user.id}</dd>
        <dt className="text-sm text-ink-muted">Ad</dt>
        <dd className="text-sm">{safeUserName(user)}</dd>
        <dt className="text-sm text-ink-muted">Kullanıcı adı</dt>
        <dd className="text-sm">{user.username ?? EMPTY_VALUE}</dd>
      </dl>

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
