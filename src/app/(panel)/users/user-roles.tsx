import { AuthorizationForm } from "@/components/panel/authz/authorization-form";
import { formatDateTime } from "@/lib/format";
import {
  MARKETPLACE_ROLES,
  type RoleGrant,
} from "@/server/api/marketplace-user-roles";
import { safeUserName, type SafeUser } from "@/server/api/users";

import { grantMarketplaceRole, revokeMarketplaceRole } from "./actions";

export type LoadedGrants = { readonly status: "ok"; readonly grants: readonly RoleGrant[] };
export type FailedGrants = { readonly status: "failed" };
export type UserGrants = LoadedGrants | FailedGrants;

export function UserRoleDetail({
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
