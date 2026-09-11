import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { AuthorizationForm } from "@/components/panel/authz/authorization-form";
import { PageHeader } from "@/components/panel/page-header";
import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
import {
  EmptyState,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@/components/ui";
import { EMPTY_VALUE, formatDateTime } from "@/lib/format";
import {
  pageWindow,
  readPaging,
  readParam,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import { getMarketplaceUsers, USER_PAGING } from "@/server/api/marketplace-users";
import {
  getMarketplaceUserRoles,
  MARKETPLACE_ROLES,
  type RoleGrant,
} from "@/server/api/marketplace-user-roles";
import { safeUserName, type SafeUser } from "@/server/api/users";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";

import { grantMarketplaceRole, revokeMarketplaceRole } from "./actions";

export const metadata: Metadata = { title: "Kullanıcılar" };

/**
 * Pazaryeri kullanıcı dizini ve rolleri — koala-admin#46 + #47.
 *
 * Personel dizini (`/staff`) değil: `GET /admin/users` marketplace
 * `users` tablosunu `user.read` ile arar. Rol yazımı `user.role.manage` ve
 * asıl kapı `runAuthorizationChange` — sayfanın `user.read` kapısı bir
 * Server Action'ı korumaz.
 *
 * Fetch kapının içinde: izni olmayan kişide `GET /admin/users` ve
 * `GET /admin/users/{id}/roles` hiç çıkmaz.
 *
 * `SafeUserDto` e-posta taşımaz. Operatör e-posta ile arayabilir; tabloda
 * e-posta görünmez. Fixture'da gelse Zod onu düşürür.
 */

export default async function UsersPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Kullanıcılar"
        description={
          <>
            Pazaryeri kullanıcıları. E-posta ile arayabilirsiniz; tabloda e-posta görünmez, yalnız
            ad, kullanıcı adı, kimlik ve roller durur.
          </>
        }
      />

      <RequirePermission permission="user.read">
        <UserDirectory params={params} />
      </RequirePermission>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "firstName,asc", label: "Ada göre (A-Z)" },
  { value: "firstName,desc", label: "Ada göre (Z-A)" },
  { value: "lastName,asc", label: "Soyada göre (A-Z)" },
  { value: "lastName,desc", label: "Soyada göre (Z-A)" },
];

type LoadedGrants = { readonly status: "ok"; readonly grants: readonly RoleGrant[] };
type FailedGrants = { readonly status: "failed" };
type UserGrants = LoadedGrants | FailedGrants;

async function UserDirectory({ params }: { params: SearchParams }) {
  const paging = readPaging(params, USER_PAGING);
  const rawQuery = readParam(params, "ara");
  const query = rawQuery?.trim() || null;
  const context = await getStaffContext();
  const canManage = context.has("user.role.manage");

  const viewState = {
    ...(query === null ? {} : { ara: query }),
    sirala: sortParam(paging.sort),
    boyut: String(paging.size),
  };

  const filters = (
    <QueueFilters
      filters={[
        {
          name: "sirala",
          label: "Sıralama",
          value: sortParam(paging.sort),
          options: SORT_OPTIONS,
        },
      ]}
      carry={{ boyut: String(paging.size), ...(query === null ? {} : { ara: query }) }}
      notice={
        <>
          Arama ve sıralama backend&apos;e gider; gelen sayfa tarayıcıda yeniden süzülmez. Arama
          e-posta ve ad+soyad üzerindedir. E-posta yanıtta yoktur.
        </>
      }
    />
  );

  const accessToken = await getKoalaAccessToken();

  let page;
  try {
    page = await getMarketplaceUsers(accessToken, { query, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <UserSearch query={query} state={viewState} />
        <QueueLoadFailure
          subject="Kullanıcı dizini"
          permission="user.read"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const users = page.content;
  const grantsByUser = await loadGrants(accessToken, users);

  return (
    <div className="flex flex-col gap-6">
      {filters}
      <UserSearch query={query} state={viewState} />

      {canManage ? null : (
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
          Yalnız okuma: hesabınızda <code className="font-mono">user.role.manage</code> izni yok, bu
          yüzden rol verme ve geri alma formları çizilmedi. Bu bir gizleme değil bir yansıma —
          backend o uçları zaten 403 ile reddeder.
        </p>
      )}

      {users.length === 0 ? (
        <EmptyState
          title={query === null ? "Kayıtlı kullanıcı yok." : "Aramayla eşleşen kullanıcı yok."}
          description={
            query === null
              ? "Kuyruğu daha sonra yenileyebilirsiniz."
              : "Arama e-posta ve ad+soyad üzerinde sunucuda çalışır."
          }
        />
      ) : (
        <>
          <Table caption="Pazaryeri kullanıcıları">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Ad</TableHeaderCell>
                <TableHeaderCell>Kullanıcı adı</TableHeaderCell>
                <TableHeaderCell>Kimlik</TableHeaderCell>
                <TableHeaderCell>Roller</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>
                    <a href={`#kullanici-${user.id}`} className="text-brand hover:underline">
                      {safeUserName(user)}
                    </a>
                  </TableCell>
                  <TableCell>{user.username ?? EMPTY_VALUE}</TableCell>
                  <TableCell>
                    <span className="font-mono text-xs">{user.id}</span>
                  </TableCell>
                  <TableCell>{roleSummary(grantsByUser.get(user.id))}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Rol kayıtları</h2>
            {users.map((user) => (
              <UserRoleDetail
                key={user.id}
                user={user}
                grants={grantsByUser.get(user.id)}
                canManage={canManage}
              />
            ))}
          </section>
        </>
      )}

      <QueuePager window={pageWindow(page)} state={viewState} unit="kullanıcı" />
      {canManage ? <UserRoleAuditPointer /> : null}
    </div>
  );
}

async function loadGrants(
  accessToken: string,
  users: readonly SafeUser[],
): Promise<Map<string, UserGrants>> {
  const entries: ReadonlyArray<readonly [string, UserGrants]> = await Promise.all(
    users.map(async (user) => {
      try {
        const grants = await getMarketplaceUserRoles(accessToken, user.id);
        return [user.id, { status: "ok" as const, grants }];
      } catch {
        return [user.id, { status: "failed" as const }];
      }
    }),
  );

  return new Map(entries);
}

function roleSummary(loaded: UserGrants | undefined): string {
  if (loaded === undefined || loaded.status === "failed") {
    return "Roller yüklenemedi.";
  }
  if (loaded.grants.length === 0) {
    return "Rolsüz";
  }
  return loaded.grants.map((grant) => grant.role).join(", ");
}

function UserRoleDetail({
  user,
  grants,
  canManage,
}: {
  user: SafeUser;
  grants: UserGrants | undefined;
  canManage: boolean;
}) {
  const label = safeUserName(user);
  const held =
    grants !== undefined && grants.status === "ok" ? grants.grants.map((grant) => grant.role) : [];
  const grantable = MARKETPLACE_ROLES.filter((role) => !held.includes(role));

  return (
    <article
      id={`kullanici-${user.id}`}
      className="flex flex-col gap-4 rounded-xl border border-border-subtle bg-surface p-4"
    >
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-semibold">{label}</h3>
        <p className="font-mono text-xs break-all text-ink-muted">{user.id}</p>
      </header>

      {grants === undefined || grants.status === "failed" ? (
        <p className="text-sm text-ink-muted">
          Roller yüklenemedi. Liste duruyor; yazma formları bu kayıt için çizilmedi.
        </p>
      ) : grants.grants.length === 0 ? (
        <p className="text-sm text-ink-muted">Bu kullanıcının hiç rolü yok.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {grants.grants.map((grant) => (
            <li
              key={grant.role}
              className="flex flex-col gap-2 rounded-md border border-border-subtle px-3 py-2 sm:flex-row sm:flex-wrap sm:items-center"
            >
              <span className="font-mono text-sm">{grant.role}</span>
              <span className="text-xs text-ink-muted">
                {formatDateTime(grant.grantedAt)}
                {" · "}
                {grant.grantedByName ?? "Veren kayıtlı değil"}
              </span>
              {canManage ? (
                <AuthorizationForm
                  action={revokeMarketplaceRole}
                  hiddenFields={{ userId: user.id, userLabel: label, role: grant.role }}
                  submitLabel="Rolü geri al"
                  layout="inline"
                  tone="danger"
                  idPrefix={`rol-al-${user.id}-${grant.role}`}
                  consequence={`${grant.role} geri alınır. ROLE_USER, son ROLE_ADMIN, kendi admin rolü (köprü) ve sistem kullanıcısı backend'de 409 ile korunur.`}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {canManage && grants?.status === "ok" ? (
        <AuthorizationForm
          action={grantMarketplaceRole}
          hiddenFields={{ userId: user.id, userLabel: label }}
          submitLabel="Rol ver"
          idPrefix={`rol-ver-${user.id}`}
          consequence="Seçilen pazaryeri rolü bu kullanıcıya verilir. Personel rolleri (OWNER vs.) burada değil."
          fields={[
            {
              name: "role",
              label: "Verilecek rol",
              type: "select",
              required: true,
              options: grantable.map((role) => ({ value: role, label: role })),
            },
          ]}
          disabled={grantable.length === 0}
          disabledReason="Bu kullanıcı her pazaryeri rolünü zaten taşıyor."
        />
      ) : null}
    </article>
  );
}

function UserRoleAuditPointer() {
  return (
    <AuditPointer permission="user.role.manage" linkLabel="Kullanıcı rol kayıtlarını aç">
      Backend başarılı vermeyi <code className="font-mono">user.role.grant</code>, geri almayı{" "}
      <code className="font-mono">user.role.revoke</code> adıyla kaydeder. Personel üyelik
      yazımlarından ayrı izin — <code className="font-mono">staff.manage</code> bu uçları açmaz.
    </AuditPointer>
  );
}

function UserSearch({
  query,
  state,
}: {
  query: string | null;
  state: Readonly<Record<string, string>>;
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      {Object.entries(state)
        .filter(([name]) => name !== "ara")
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <input type="hidden" name="sayfa" value="0" />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="kullanici-ara" className="text-sm font-medium text-ink">
          Ad ya da e-posta ara
        </label>
        <input
          id="kullanici-ara"
          name="ara"
          type="search"
          defaultValue={query ?? ""}
          placeholder="ör. ada yılmaz veya ada@example.com"
          className="w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-subtle"
        />
      </div>
      <button
        type="submit"
        className="rounded-md border border-border-subtle px-3 py-2 text-sm font-medium text-ink hover:bg-surface-sunken"
      >
        Ara
      </button>
    </form>
  );
}
