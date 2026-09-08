import type { Metadata } from "next";
import Link from "next/link";

import { AuthorizationForm } from "@/components/panel/authz/authorization-form";
import { QueueFilters, QueueLoadFailure, QueuePager } from "@/components/panel/queue";
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
import { EMPTY_VALUE, formatDateTime, formatInteger } from "@/lib/format";
import {
  pageWindow,
  readPaging,
  readParam,
  sortParam,
  type SearchParams,
} from "@/server/api/paging";
import {
  STAFF_BACKEND_GAPS,
  STAFF_MFA_NOTICE,
  STAFF_PASSWORD_MIN_LENGTH,
  STAFF_PAGING,
  getStaffMembers,
  staffLockState,
  type StaffMember,
} from "@/server/api/staff-members";
import { getStaffRoles, type StaffRole } from "@/server/api/staff-roles";
import { getKoalaAccessToken } from "@/server/auth/session";
import { RequirePermission } from "@/server/authz/require-permission";
import { getStaffContext } from "@/server/authz/staff-context";
import { classifyQueueFailure } from "@/server/queue/decisions";

import {
  createStaff,
  grantRoleToStaff,
  resetStaffPasswordAction,
  revokeRoleFromStaff,
  setStaffActive,
} from "./actions";

export const metadata: Metadata = { title: "Personel" };

/**
 * Personel ve rol üyeliği — koala-admin#9'un ADR-0014 ile büyüyen yarısı.
 *
 * ADR-0010 üyeliği dış kimlik sağlayıcısına vermişti, yani "kim hangi rolde"
 * sorusu onun yönetim konsolunun işiydi. ADR-0014 o sağlayıcıyı projeden
 * çıkardı; konsol yok, iş burada. Yan kazanç ADR'nin kendi cümlesiyle: rol ataması artık Koala'nın
 * denetim kaydına giriyor ve **rol iptali anında geçerli** oluyor, çünkü üyelik
 * her istekte veritabanından okunuyor.
 *
 * ## İki izin, tek ekran
 *
 * Sayfanın kapısı `staff.read`: gösterdiği şey `GET /admin/staff` ve backend
 * onu o izne bağlamış. Yazma formlarının hepsi `staff.manage` istiyor ve o
 * kontrol **iki yerde** duruyor:
 *
 *  - Burada, kozmetik olarak: izni olmayan birine, basınca 403 alacağı düğmeler
 *    gösterilmiyor.
 *  - `runAuthorizationChange`'de, gerçek olarak: her gönderimde izin
 *    `/admin/me`'den yeniden çözülüyor. Asıl kapı orası, çünkü bir Server
 *    Action kendi URL'i olan bir POST ucudur ve bu sayfanın `staff.read`
 *    kapısı onun için hiç çalışmaz.
 *
 * ## MFA yok, ve bu ekran bunu söylüyor
 *
 * ADR-0014 çok adımlı doğrulamanın yokluğunu açık bir gerileme olarak kaydetti.
 * Personel oluşturma formu {@link STAFF_MFA_NOTICE}'ı taşıyor: bu parola,
 * panelin tamamına — para hareketleri dâhil — açılan tek kapı.
 */
export default async function StaffPage({
  searchParams,
}: {
  searchParams?: Promise<SearchParams>;
}) {
  const params = searchParams === undefined ? {} : await searchParams;

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Personel</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Personel kayıtları ve rol üyeliği. Listeyi görmek{" "}
          <code className="font-mono">staff.read</code>, değiştirmek{" "}
          <code className="font-mono">staff.manage</code> izni gerektirir. Rol iptali anında
          geçerlidir: üyelik her istekte veritabanından okunur (ADR-0014).
        </p>
      </header>

      <RequirePermission permission="staff.read">
        <StaffDirectory params={params} />
      </RequirePermission>
    </div>
  );
}

const SORT_OPTIONS = [
  { value: "createdAt,desc", label: "En yeni önce" },
  { value: "createdAt,asc", label: "En eski önce" },
  { value: "email,asc", label: "E-postaya göre (A-Z)" },
  { value: "displayName,asc", label: "Ada göre (A-Z)" },
];

async function StaffDirectory({ params }: { params: SearchParams }) {
  const paging = readPaging(params, STAFF_PAGING);
  const query = readParam(params, "ara");

  /**
   * `staff.manage` ayrıca soruluyor, ama bu bir kapı değil bir görünüm kararı:
   * yazma formlarını gizlemek kimseyi durdurmaz — durduran şey
   * `runAuthorizationChange`. `getStaffContext()` React'in `cache()`'i içinde,
   * yani layout'un ve gate'in çağrılarıyla aynı tek `GET /admin/me`'yi
   * paylaşıyor; bu satır ek bir istek getirmiyor.
   */
  const context = await getStaffContext();
  const canManage = context.has("staff.manage");

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
          Sıralama sunucuya gider; gelen sayfa panelde süzülmez. Backend yalnız{" "}
          <code className="font-mono">createdAt</code>, <code className="font-mono">email</code> ve{" "}
          <code className="font-mono">displayName</code> alanlarına göre sıralar.
        </>
      }
    />
  );

  let page;
  let roles: StaffRole[] = [];
  try {
    page = await getStaffMembers(await getKoalaAccessToken(), { query, paging });
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        {filters}
        <QueueLoadFailure
          subject="Personel listesi"
          permission="staff.read"
          failure={classifyQueueFailure(error)}
        />
        <BackendGaps />
      </div>
    );
  }

  /**
   * Rol listesi yalnız atama seçeneklerini çizmek için, ve yalnız yazma izni
   * varken isteniyor. `GET /admin/roles` `role.manage` istiyor — `staff.manage`
   * taşıyan ama rol grafiğini yönetmeyen birinde 403 döner, ve o 403 personel
   * listesini götürmemeli. Bu yüzden ayrı bir `try` ve boş bir liste: rol
   * atama formu o durumda hiç çizilmiyor, sebebi yazılı.
   */
  let roleListFailed = false;
  if (canManage) {
    try {
      roles = await getStaffRoles(await getKoalaAccessToken());
    } catch {
      roleListFailed = true;
    }
  }

  const members = page.content;

  return (
    <div className="flex flex-col gap-6">
      {filters}

      <SearchForm query={query} paging={{ size: paging.size, sort: sortParam(paging.sort) }} />

      {canManage ? null : (
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3 text-sm text-ink-muted">
          Yalnız okuma: hesabınızda <code className="font-mono">staff.manage</code> izni yok, bu
          yüzden personel oluşturma, rol atama, devre dışı bırakma ve parola atama formları
          çizilmedi. Bu bir gizleme değil bir yansıma — backend o uçları zaten 403 ile reddeder.
        </p>
      )}

      {members.length === 0 ? (
        <EmptyState
          title={query === null ? "Kayıtlı personel yok." : "Aramayla eşleşen personel yok."}
          description={
            query === null
              ? "İlk OWNER hesabı backend'in BOOTSTRAP_OWNER_* değişkenleriyle doğar; boş bir liste, bootstrap'in hiç çalışmadığı anlamına gelir."
              : "Arama ad ve e-posta üzerinde sunucuda çalışır."
          }
        />
      ) : (
        <>
          <Table caption="Personel">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Ad</TableHeaderCell>
                <TableHeaderCell>E-posta</TableHeaderCell>
                <TableHeaderCell>Roller</TableHeaderCell>
                <TableHeaderCell>Durum</TableHeaderCell>
                <TableHeaderCell>Oluşturulma</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {members.map((member) => (
                <TableRow key={member.id}>
                  <TableCell>
                    <a href={`#personel-${member.id}`} className="text-brand hover:underline">
                      {member.displayName ?? EMPTY_VALUE}
                    </a>
                  </TableCell>
                  <TableCell>
                    <span className="break-all">{member.email}</span>
                  </TableCell>
                  <TableCell>
                    {member.roles.length === 0 ? (
                      <span className="text-ink-muted">Rolsüz</span>
                    ) : (
                      member.roles.join(", ")
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadges member={member} />
                  </TableCell>
                  <TableCell>{formatDateTime(member.createdAt)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <QueuePager
            window={pageWindow(page)}
            state={{
              sirala: sortParam(paging.sort),
              boyut: String(paging.size),
              ...(query === null ? {} : { ara: query }),
            }}
            unit="personel"
          />

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Personel kayıtları</h2>
            {members.map((member) => (
              <StaffDetail
                key={member.id}
                member={member}
                roles={roles}
                roleListFailed={roleListFailed}
                canManage={canManage}
                isSelf={context.staff?.staffId === member.id}
              />
            ))}
          </section>
        </>
      )}

      {canManage ? <CreateStaffSection /> : null}
      <AuditPointer />
      <BackendGaps />
    </div>
  );
}

/**
 * Arama kutusu — GET formu, çünkü sonucu paylaşılabilir bir URL olmalı.
 *
 * `QueueFilters` seçim kutuları için; serbest metin onun sözleşmesinde yok ve
 * onu genişletmek üç ekranı birden etkilerdi.
 */
function SearchForm({
  query,
  paging,
}: {
  query: string | null;
  paging: { size: number; sort: string };
}) {
  return (
    <form className="flex flex-wrap items-end gap-3" method="get">
      <input type="hidden" name="sirala" value={paging.sort} />
      <input type="hidden" name="boyut" value={String(paging.size)} />
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor="personel-ara" className="text-sm font-medium text-ink">
          Ad ya da e-posta ara
        </label>
        <input
          id="personel-ara"
          name="ara"
          type="search"
          defaultValue={query ?? ""}
          placeholder="ör. trust-lead@koala.local"
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

function StatusBadges({ member }: { member: StaffMember }) {
  return (
    <span className="flex flex-wrap gap-1">
      {member.active ? (
        <Badge tone="success">Etkin</Badge>
      ) : (
        <Badge tone="danger">Devre dışı</Badge>
      )}
      {member.mustChangePassword ? <Badge tone="warning">Parola değiştirmeli</Badge> : null}
      {staffLockState(member) === "ACTIVE" ? (
        <Badge tone="warning">Kilitli — {formatDateTime(member.lockedUntil)}</Badge>
      ) : null}
    </span>
  );
}

function StaffDetail({
  member,
  roles,
  roleListFailed,
  canManage,
  isSelf,
}: {
  member: StaffMember;
  roles: readonly StaffRole[];
  roleListFailed: boolean;
  canManage: boolean;
  isSelf: boolean;
}) {
  const grantable = roles.filter((role) => !member.roles.includes(role.code));
  const lock = staffLockState(member);

  return (
    <details
      id={`personel-${member.id}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span>{member.displayName ?? member.email}</span>
        <StatusBadges member={member} />
        {isSelf ? <Badge tone="brand">Bu sizsiniz</Badge> : null}
      </summary>

      <div className="mt-4 flex flex-col gap-6">
        <dl className="grid gap-x-6 gap-y-2 sm:grid-cols-[12rem_1fr]">
          <dt className="text-sm text-ink-muted">Personel kimliği</dt>
          <dd className="font-mono text-sm break-all">{member.id}</dd>

          <dt className="text-sm text-ink-muted">E-posta</dt>
          <dd className="text-sm break-all">{member.email}</dd>

          <dt className="text-sm text-ink-muted">Görünen ad</dt>
          <dd className="text-sm">{member.displayName ?? EMPTY_VALUE}</dd>

          <dt className="text-sm text-ink-muted">Doğrudan roller</dt>
          <dd className="text-sm">
            {member.roles.length === 0 ? "Hiçbiri — bu hesap hiçbir ekrana ulaşamaz." : null}
            {member.roles.length === 0 ? null : member.roles.join(", ")}
            <span className="mt-1 block text-xs text-ink-muted">
              Yalnız doğrudan üyelikler. Bu rollerin kapsadıklarıyla birlikte gerçekte neye
              ulaştığını görmek için{" "}
              <Link href="/roles" className="text-brand hover:underline">
                rol grafiğine
              </Link>{" "}
              bakın.
            </span>
          </dd>

          <dt className="text-sm text-ink-muted">Oluşturulma</dt>
          <dd className="text-sm">{formatDateTime(member.createdAt)}</dd>

          <dt className="text-sm text-ink-muted">Kilit</dt>
          <dd className="text-sm">
            {lock === "NONE" ? "Yok" : null}
            {lock === "ACTIVE" ? `${formatDateTime(member.lockedUntil)} tarihine kadar` : null}
            {lock === "EXPIRED"
              ? `Süresi dolmuş (${formatDateTime(member.lockedUntil)}); hesap giriş yapabilir.`
              : null}
            <span className="mt-1 block text-xs text-ink-muted">
              Kaba kuvvet kilidi. Kilidi elle açan bir uç yok; parola atamak onu temizler, yoksa
              süresinin dolması beklenir.
            </span>
          </dd>
        </dl>

        {canManage ? (
          <>
            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-ink">Rol üyeliği</h3>

              {member.roles.length === 0 ? null : (
                <ul className="flex flex-col gap-2">
                  {member.roles.map((roleCode) => (
                    <li
                      key={roleCode}
                      className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle px-3 py-2"
                    >
                      <span className="font-mono text-sm">{roleCode}</span>
                      <AuthorizationForm
                        action={revokeRoleFromStaff}
                        hiddenFields={{
                          staffId: member.id,
                          staffLabel: member.displayName ?? member.email,
                          roleCode,
                        }}
                        submitLabel="Rolü geri al"
                        layout="inline"
                        tone="danger"
                        idPrefix={`rol-al-${member.id}-${roleCode}`}
                        consequence={`${roleCode} rolü geri alınır ve etki anında geçerli olur. Kendi son yönetim üyeliğinizi ya da sistemdeki son yöneticiyi bırakamazsınız: backend ikisini de 409 ile reddeder.`}
                      />
                    </li>
                  ))}
                </ul>
              )}

              {roleListFailed ? (
                <p className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink-muted">
                  Rol listesi okunamadı, bu yüzden rol atama formu çizilmedi.{" "}
                  <code className="font-mono">GET /admin/roles</code>{" "}
                  <code className="font-mono">role.manage</code> izni istiyor; personel yönetimi
                  izniniz var ama rol grafiği izniniz yoksa beklenen durum budur.
                </p>
              ) : (
                <AuthorizationForm
                  action={grantRoleToStaff}
                  hiddenFields={{
                    staffId: member.id,
                    staffLabel: member.displayName ?? member.email,
                  }}
                  submitLabel="Rol ata"
                  idPrefix={`rol-ata-${member.id}`}
                  consequence="Seçilen rol bu personele verilir ve etki bir sonraki istekte geçerli olur. Backend, rolün etkili izinlerinin tamamına sahip olmayan aktörü 403 ile reddeder — kendinizde olmayan bir yetkiyi dağıtamazsınız."
                  fields={[
                    {
                      name: "roleCode",
                      label: "Atanacak rol",
                      type: "select",
                      required: true,
                      hint: "Üyelik uçları rolü koduyla adresler (UUID ile değil).",
                      options: grantable.map((role) => ({
                        value: role.code,
                        label: `${role.code} — ${role.name}`,
                      })),
                    },
                  ]}
                  disabled={grantable.length === 0}
                  disabledReason="Bu personel her rolü zaten taşıyor."
                />
              )}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-ink">Hesap durumu</h3>
              <AuthorizationForm
                action={setStaffActive}
                hiddenFields={{
                  staffId: member.id,
                  staffLabel: member.displayName ?? member.email,
                  active: member.active ? "false" : "true",
                }}
                submitLabel={member.active ? "Devre dışı bırak" : "Yeniden etkinleştir"}
                tone={member.active ? "danger" : "default"}
                idPrefix={`durum-${member.id}`}
                consequence={
                  member.active
                    ? "Hesap devre dışı kalır: açık oturumlarının tamamı anında geçersiz olur (token sürümü artar) ve giriş denemesi de reddedilir. Kayıt silinmez, listede pasif olarak durur."
                    : "Hesap yeniden giriş yapabilir hâle gelir. Rolleri olduğu gibi durur."
                }
              />
              {isSelf ? (
                <p className="max-w-prose rounded-md border border-warning/30 bg-warning-soft px-3 py-2 text-xs text-ink">
                  Bu sizin hesabınız. Kendinizi devre dışı bırakmak, yönetim izninizi de düşüreceği
                  için backend tarafından 409 ile reddedilir (
                  <code className="font-mono">STAFF_MEMBERSHIP_SELF_LOCKOUT</code>).
                </p>
              ) : null}
            </section>

            <section className="flex flex-col gap-3">
              <h3 className="text-sm font-semibold text-ink">Parola ata</h3>
              <AuthorizationForm
                action={resetStaffPasswordAction}
                hiddenFields={{
                  staffId: member.id,
                  staffLabel: member.displayName ?? member.email,
                }}
                submitLabel="Parolayı ata"
                tone="danger"
                idPrefix={`parola-${member.id}`}
                consequence="Yeni parola hemen geçerli olur, hesap 'ilk girişte değiştir' bayrağını alır, kilidi temizlenir ve açık oturumları sonlandırılır. Parolayı kişiye panel dışından iletmeniz gerekir: backend e-posta göndermez ve panel onu bir daha göstermez."
                fields={[
                  {
                    name: "password",
                    label: "Yeni parola",
                    type: "password",
                    required: true,
                    minLength: STAFF_PASSWORD_MIN_LENGTH,
                    autoComplete: "new-password",
                    hint: `En az ${STAFF_PASSWORD_MIN_LENGTH} karakter. Kişi ilk girişinde bunu değiştirmek zorunda kalacak; o bayrak inene kadar /admin/** uçlarının tamamı 403 döner.`,
                  },
                ]}
              />
            </section>
          </>
        ) : null}
      </div>
    </details>
  );
}

function CreateStaffSection() {
  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border-subtle bg-surface px-4 py-4">
      <h2 className="text-lg font-semibold">Personel oluştur</h2>

      <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
        <p className="text-sm font-semibold text-warning">{STAFF_MFA_NOTICE.title}</p>
        <p className="max-w-prose text-sm text-ink">{STAFF_MFA_NOTICE.detail}</p>
      </div>

      <AuthorizationForm
        action={createStaff}
        hiddenFields={{}}
        submitLabel="Personeli oluştur"
        idPrefix="personel-olustur"
        consequence="Hesap etkin olarak ve 'ilk girişte parolayı değiştir' bayrağıyla doğar; o bayrak inene kadar /admin/** uçlarının tamamı 403 döner. Hiçbir rolü olmaz, yani giriş yapsa da hiçbir ekrana ulaşamaz — rolü ayrıca atamanız gerekir. Parolayı kişiye panel dışından iletin."
        fields={[
          {
            name: "email",
            label: "E-posta",
            type: "email",
            required: true,
            autoComplete: "off",
            hint: "Giriş kimliği budur ve sonradan değiştirilemez: PATCH /admin/staff yalnız `active` alanını kabul ediyor.",
          },
          {
            name: "displayName",
            label: "Görünen ad",
            type: "text",
            autoComplete: "off",
            hint: "İsteğe bağlı ama önerilir: boş bırakılırsa denetim kaydında ve panelde e-posta görünür. Bu da sonradan değiştirilemez.",
          },
          {
            name: "password",
            label: "İlk parola",
            type: "password",
            required: true,
            minLength: STAFF_PASSWORD_MIN_LENGTH,
            autoComplete: "new-password",
            hint: `En az ${STAFF_PASSWORD_MIN_LENGTH} karakter, UTF-8 olarak en fazla 72 bayt. MFA yok; bu parola tek savunma.`,
          },
        ]}
      />
    </section>
  );
}

function AuditPointer() {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">Her değişiklik denetim kaydında</h2>
      <p className="max-w-prose text-xs text-ink-muted">
        Personel oluşturma, devre dışı bırakma, rol atama ve parola atama — hepsi kim, ne zaman,
        hangi izin ve hangi kaynak bilgisiyle kayda giriyor; üyelik yazımları ayrıca öncesini ve
        sonrasını damgalıyor (<code className="font-mono">active=…; roles=[…]</code>). ADR-0010 bu
        kaydın dış bir yönetim konsolunda <em>tutulamadığını</em> açıkça kayıp yazmıştı; ADR-0014
        onu geri kazandırdı.
      </p>
      <p className="text-xs text-ink-muted">
        <Link
          href={{ pathname: "/audit-log", query: { permission: "staff.manage" } }}
          className="text-brand hover:underline"
        >
          Personel değişikliklerini denetim kaydında aç
        </Link>{" "}
        — <code className="font-mono">audit.read</code> izni gerekir.
      </p>
    </section>
  );
}

function BackendGaps() {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">
        Backend&apos;in veremedikleri ({formatInteger(STAFF_BACKEND_GAPS.length)})
      </h2>
      <p className="max-w-prose text-xs text-ink-muted">
        koala-admin#9&apos;un istediği ama <code className="font-mono">StaffMembersController</code>
        &apos;ın bugün karşılayamadığı maddeler. Panel bunları taklit etmiyor.
      </p>
      <dl className="flex flex-col gap-2">
        {STAFF_BACKEND_GAPS.map((gap) => (
          <div key={gap.id} className="flex flex-col">
            <dt className="text-sm font-medium text-ink">{gap.title}</dt>
            <dd className="max-w-prose text-xs text-ink-muted">{gap.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
