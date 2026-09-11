import Link from "next/link";
import type { Metadata, Route } from "next";

import { PageHeader } from "@/components/panel/page-header";
import { QueueLoadFailure } from "@/components/panel/queue";
import { EMPTY_VALUE } from "@/lib/format";
import { getMarketplaceUser } from "@/server/api/marketplace-users";
import { getMarketplaceUserRoles } from "@/server/api/marketplace-user-roles";
import { safeUserName } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { UserRoleDetail, type UserGrants } from "../user-roles";

export const metadata: Metadata = { title: "Kullanıcı" };

const OBJECT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Pazaryeri kullanıcı nesnesi. SafeUser + roller; askıya alma yoktur.
 * Kapı `user.read`: izni olmayan kişide GET /admin/users/{id} çıkmaz.
 */
export default async function UserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
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
  if (!OBJECT_ID.test(id)) {
    return (
      <p className="text-sm text-ink-muted">Kullanıcı kimliği geçersiz. Dizinden bir satır açın.</p>
    );
  }

  const accessToken = await getKoalaAccessToken();
  const context = await getStaffContext();
  const canManage = context.has("user.role.manage");

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

      <p className="text-sm">
        <Link
          href={{ pathname: "/reports", query: { kullanici: user.id } }}
          className="text-brand hover:underline"
        >
          Bu kullanıcının şikayetleri
        </Link>
      </p>

      <UserRoleDetail user={user} grants={grants} canManage={canManage} />
    </div>
  );
}
