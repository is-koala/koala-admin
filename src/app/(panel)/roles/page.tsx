import type { Metadata } from "next";

import { AuditPointer } from "@/components/panel/authz/audit-pointer";
import { AuthorizationForm } from "@/components/panel/authz/authorization-form";
import { SeparationBadge } from "@/components/panel/authz/separation";
import { PageHeader } from "@/components/panel/page-header";
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
import { EMPTY_VALUE, formatInteger } from "@/lib/format";
import {
  FINANCE_BRANCH_ROLES,
  TRUST_BRANCH_ROLES,
  closuresWithSelf,
  separationSentence,
  separationVerdict,
  wouldViolateSeparationAfterInclude,
  wouldCycle,
  type RoleClosures,
  type RoleGraphNode,
  type SeparationVerdict,
} from "@/lib/role-graph";
import { roleOptionValue, type RoleCode } from "@/lib/role-identity";
import { QueueLoadFailure } from "@/components/panel/queue";
import { getAllStaffMembers } from "@/server/api/staff-members";
import {
  getStaffPermissionCatalog,
  getStaffRoles,
  type StaffPermissionEntry,
  type StaffRole,
} from "@/server/api/staff-roles";
import { getKoalaAccessToken } from "@/server/auth/session";
import { getStaffContext } from "@/server/authz/staff-context";
import { isPermission, permissionLabel } from "@/server/authz/permissions";
import { RequirePermission } from "@/server/authz/require-permission";
import { classifyQueueFailure } from "@/server/queue/decisions";

import {
  addRoleInclude,
  grantPermissionToRole,
  removeRoleInclude,
  revokePermissionFromRole,
} from "./actions";

export const metadata: Metadata = { title: "Roller ve izinler" };

/**
 * Rol→izin DAG'ı — koala-admin#9'un ilk yarısı.
 *
 * Bu ekrandan önce bir rolün ne yapabildiğini değiştirmenin tek yolu canlı
 * veritabanına elle yazılan bir SQL cümlesiydi.
 *
 * ## Üç şey bu sayfanın omurgası
 *
 *  1. **Veri çekimi kapının içinde.** `<RoleGraph>` `<RequirePermission>`'a bir
 *     *element* olarak veriliyor, çağrı olarak değil; izin yoksa bileşen
 *     fonksiyonu hiç çalışmaz, token okunmaz ve `GET /admin/roles` sunucudan
 *     hiç çıkmaz. `roles.test.tsx` bunu istek *sayısıyla* ölçüyor.
 *  2. **Doğrudan izin ile etkili izin ayrı gösteriliyor.** Backend ikisini ayrı
 *     alanlarda veriyor (`permissions` / `effectivePermissions`) ve panel de
 *     ayrı gösteriyor: bir rolden izni kaldırıp kalıtımla geri geldiğini
 *     görmemek, bu ekranda yapılabilecek en pahalı hata.
 *  3. **Etkili izin listesi backend'in kenarlarından türetiliyor, ve bu bir
 *     gösterim — yetkilendirme değil.** `GET /admin/roles` grafiğin tamamını
 *     tek cevapta veriyor; panel `StaffAuthorizationManager.graph()`'in kendi
 *     tanımını uyguluyor (kapanış üzerindeki doğrudan izinlerin birleşimi).
 *     `roles.test.tsx` bunu `StaffRoleDetailDto`'nun `effectivePermissions` ve
 *     `effectiveRoles` alanlarını taşıyan bir detay cevabına karşı ölçüyor:
 *     panel o ucu **çağırmıyor** (test bunu istek sayısıyla da sabitliyor) ama
 *     ürettiği listenin onunla aynı olması gerekiyor. Burada hesaplanan sayı
 *     kimseye bir kapı açmıyor: neye izin verileceğine hâlâ her istekte backend
 *     karar veriyor (ADR-0010, ADR-0014). Alternatif — rol başına
 *     `GET /admin/roles/{roleId}` — on rol için on istekti; gerekçe
 *     `src/server/api/staff-roles.ts`'te yazılı.
 *
 * ## Görev ayrılığı: backend kuralının ön izlemesi
 *
 * ADR-0014 §Rol grafiği "OWNER dışında hiçbir rol hem trust hem finans dalını
 * kapsayamaz" diyor. koala-backend rol grafiği yazımlarından sonra etkilenen
 * roller ile personel üyeliklerinin kapanışını yeniden hesaplayıp ihlali 409 ile
 * reddediyor. Panel aynı hesabı yalnız seçimden önce açıklama yapmak için taşır;
 * nihai karar her zaman backend'indir.
 */
export default async function RolesPage() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Roller ve izinler"
        description={
          <>
            Rol grafiği ve roller arası kapsama. Değişiklik ilgili personelin bir sonraki isteğinde
            geçerlidir.
          </>
        }
      />

      <RequirePermission permission="role.manage">
        <RoleGraph />
      </RequirePermission>
    </div>
  );
}

async function RoleGraph() {
  const accessToken = await getKoalaAccessToken();
  const context = await getStaffContext();

  let roles: StaffRole[];
  let catalog: StaffPermissionEntry[];
  let memberRoles: readonly (readonly RoleCode[])[];
  try {
    /**
     * Rol ve izin kataloğu zorunlu iki istek. `staff.read` varsa personel
     * üyelikleri de son sayfaya kadar okunuyor; backend bir kapsama yazımında
     * rol kapanışlarının yanında etkilenen kişileri de denetliyor.
     */
    const [loadedRoles, loadedCatalog, members] = await Promise.all([
      getStaffRoles(accessToken),
      getStaffPermissionCatalog(accessToken),
      context.has("staff.read") ? getAllStaffMembers(accessToken) : Promise.resolve([]),
    ]);
    roles = loadedRoles;
    catalog = loadedCatalog;
    memberRoles = members.map((member) => member.roles);
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        <QueueLoadFailure
          subject="Rol grafiği"
          permission="role.manage"
          failure={classifyQueueFailure(error)}
        />
      </div>
    );
  }

  const graph: RoleGraphNode[] = roles.map((role) => ({
    code: role.code,
    includes: role.includes.map((included) => included.code),
  }));

  /**
   * Kapanışlar bir kez, sonra hiç.
   *
   * Aynı sorunun cevabı bu sayfada beş yerde lazım: tablodaki satır, rol
   * detayı, etkili izin listesi, döngü kontrolü ve rozet. Hepsi bu haritadan
   * okuyor — daha önce her biri grafiği yeniden geziyordu ve beş rol için bir
   * render'da altmış bir kapanış hesaplanıyordu.
   */
  const closures = closuresWithSelf(graph);
  const byCode = new Map(roles.map((role) => [role.code, role]));

  const rows: RoleRow[] = roles.map((role) => {
    const closure = closures.get(role.code) ?? [role.code];
    return {
      role,
      closure,
      verdict: separationVerdict(role.code, closure),
      effective: effectivePermissionsIn(byCode, closure),
    };
  });

  return (
    <div className="flex flex-col gap-6">
      <SeparationNotice membershipPreviewComplete={context.has("staff.read")} />

      {roles.length === 0 ? (
        <EmptyState
          title="Hiç rol yok."
          description="Roller Liquibase seed'iyle gelir ve panelden yaratılamaz; boş bir liste, seed'in çalışmadığı anlamına gelir."
        />
      ) : (
        <>
          <Table caption="Rol grafiği">
            <TableHead>
              <TableRow>
                <TableHeaderCell>Rol</TableHeaderCell>
                <TableHeaderCell>Doğrudan izin</TableHeaderCell>
                <TableHeaderCell>Kapsadığı roller</TableHeaderCell>
                <TableHeaderCell>Etkili izin</TableHeaderCell>
                <TableHeaderCell>Görev ayrılığı</TableHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.map(({ role, verdict, effective }) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <a href={`#rol-${role.code}`} className="text-brand hover:underline">
                      {role.code}
                    </a>
                    <span className="block text-xs text-ink-muted">{role.name}</span>
                  </TableCell>
                  <TableCell>{formatInteger(role.permissions.length)}</TableCell>
                  <TableCell>
                    {role.includes.length === 0
                      ? EMPTY_VALUE
                      : role.includes.map((included) => included.code).join(", ")}
                  </TableCell>
                  <TableCell>{formatInteger(effective.length)}</TableCell>
                  <TableCell>
                    <SeparationBadge verdict={verdict} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Rol detayları</h2>
            {rows.map((row) => (
              <RoleDetail
                key={row.role.id}
                row={row}
                roles={roles}
                graph={graph}
                closures={closures}
                memberRoles={memberRoles}
                catalog={catalog}
              />
            ))}
          </section>
        </>
      )}

      <RoleAuditPointer />
    </div>
  );
}

/**
 * Bir rol satırı: rolün kendisi ve onun hakkında bir kez hesaplanmış her şey.
 *
 * Tablo ile detay bölümü aynı sayıları göstermek zorunda, ve ikisinin ayrı
 * hesaplaması onların ayrışabileceği anlamına gelirdi.
 */
interface RoleRow {
  readonly role: StaffRole;
  /** Kapanış, rolün kendisi dâhil. */
  readonly closure: readonly RoleCode[];
  readonly verdict: SeparationVerdict;
  readonly effective: readonly string[];
}

/**
 * Etkili izinler — bir kapanış üzerindeki doğrudan izinlerin birleşimi.
 *
 * `StaffAuthorizationManager.graph()` ile **aynı** tanım: doğrudan olanlar ∪
 * ulaşılan her rolün doğrudan olanları. Backend bunu `effectivePermissions`
 * olarak hazır veriyor ama yalnız `GET /admin/roles/{roleId}`'de, yani rol
 * başına bir istekle; gerekçe `src/server/api/staff-roles.ts`'te, eşitliğin
 * ölçüsü `roles.test.tsx`'te — orada panelin türetmesi, o DTO'nun
 * `effectivePermissions` alanını taşıyan bir cevapla karşılaştırılıyor.
 *
 * Kapanışı **çağıran** veriyor: grafiği burada yeniden gezmek, bir render'da
 * aynı hesabı onlarca kez yapmak demekti.
 *
 * Bu bir yetkilendirme kararı değil, bir gösterim: kimseye bir kapı açmıyor,
 * yalnız operatörün az önce yaptığı değişikliğin sonucunu yazdırıyor. Yanlış
 * olsaydı sonucu yanlış bir sayı olurdu, fazladan bir yetki değil.
 */
function effectivePermissionsIn(
  byCode: ReadonlyMap<RoleCode, StaffRole>,
  closure: readonly RoleCode[],
): string[] {
  const permissions = new Set<string>();
  for (const code of closure) {
    for (const permission of byCode.get(code)?.permissions ?? []) permissions.add(permission);
  }

  return [...permissions].sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * Arayüzdeki seçim ön izlemesinin backend otoritesinin yerine geçmediği burada
 * görünür kalır; bayat bir sayfadan veya doğrudan eylem çağrısından gelen yazımı
 * yine backend reddeder.
 */
function SeparationNotice({
  membershipPreviewComplete,
}: {
  readonly membershipPreviewComplete: boolean;
}) {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
      <p className="text-sm font-semibold text-warning">
        Görev ayrılığı backend tarafından uygulanır.
      </p>
      <p className="max-w-prose text-sm text-ink">
        ADR-0014 §Rol grafiği&apos;nin kuralı şu:{" "}
        <strong>
          OWNER dışında hiçbir rol hem güven dalını ({TRUST_BRANCH_ROLES.join(", ")}) hem finans
          dalını ({FINANCE_BRANCH_ROLES.join(", ")}) kapsayamaz.
        </strong>{" "}
        Backend rol grafiği yazımından sonra etkilenen bütün rol ve personel kapanışlarını yeniden
        denetler; kuralı bozan yazımı 409 ile reddeder.
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink">
        Panel, reddedileceği belli birleşimleri önceden seçilemez yapar ve nedenini seçenekte
        gösterir. Bu yalnız bir ön izlemedir; nihai kararı her istekte backend verir.
      </p>
      {membershipPreviewComplete ? null : (
        <p className="mt-2 max-w-prose text-sm text-ink">
          Bu oturum <code className="font-mono">staff.read</code> taşımadığı için personel
          üyeliklerinden doğan etkiler seçenek ön izlemesinde görünmeyebilir. Backend bu birleşimi
          yine 409 ile reddeder.
        </p>
      )}
    </div>
  );
}

function RoleDetail({
  row: { role, closure, verdict, effective },
  roles,
  graph,
  closures,
  memberRoles,
  catalog,
}: {
  row: RoleRow;
  roles: readonly StaffRole[];
  graph: readonly RoleGraphNode[];
  closures: RoleClosures;
  memberRoles: readonly (readonly RoleCode[])[];
  catalog: readonly StaffPermissionEntry[];
}) {
  const sentence = separationSentence(role.code, verdict);
  const inherited = effective.filter((permission) => !role.permissions.includes(permission));

  const grantable = catalog.filter((entry) => !role.permissions.includes(entry.code));
  /**
   * Döngü yaratacak adaylar listeden **çıkarılmıyor**, seçilemez olarak
   * kalıyor: sebebi görünsün diye. Zaten kapsanan bir rol ise çıkarılıyor,
   * çünkü orada söylenecek bir şey yok — ikinci kez eklemek backend'de sessiz
   * bir no-op.
   */
  const includable = roles.filter(
    (candidate) =>
      candidate.id !== role.id && !role.includes.some((included) => included.id === candidate.id),
  );

  return (
    <details
      id={`rol-${role.code}`}
      className="rounded-lg border border-border-subtle bg-surface px-4 py-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm font-medium text-ink">
        <span className="font-mono">{role.code}</span>
        <span className="text-ink-muted">{role.name}</span>
        <SeparationBadge verdict={verdict} />
      </summary>

      <div className="mt-4 flex flex-col gap-6">
        {sentence === null ? null : (
          <p
            className={
              verdict.violates
                ? "max-w-prose rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm text-ink"
                : "max-w-prose rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink"
            }
          >
            {sentence}
          </p>
        )}

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Doğrudan izinler ({formatInteger(role.permissions.length)})
          </h3>
          <p className="max-w-prose text-xs text-ink-muted">
            Yalnız bu role verilmiş olanlar. Kapsama yoluyla gelenler aşağıda ayrı listede — bir
            izni buradan kaldırmak, rol ona bir kapsama üzerinden hâlâ ulaşıyorsa hiçbir şeyi
            değiştirmez.
          </p>

          {role.permissions.length === 0 ? (
            <p className="text-sm text-ink-muted">Bu role doğrudan verilmiş izin yok.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {role.permissions.map((permission) => (
                <li
                  key={permission}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle px-3 py-2"
                >
                  <span className="font-mono text-sm">{permission}</span>
                  <span className="text-xs text-ink-muted">{labelOf(permission)}</span>
                  <AuthorizationForm
                    action={revokePermissionFromRole}
                    hiddenFields={{ roleId: role.id, roleCode: role.code, permission }}
                    submitLabel="Kaldır"
                    layout="inline"
                    tone="danger"
                    idPrefix={`izin-kaldir-${role.code}-${permission}`}
                    consequence={`${permission} izni ${role.code} rolünden kaldırılır ve bu rolü taşıyan herkes için etki bir sonraki istekte geçerli olur. Kendi ulaştığınız bir rolden role.manage'i kaldırmaya çalışırsanız backend 409 döndürür.`}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-3">
            <AuthorizationForm
              action={grantPermissionToRole}
              hiddenFields={{ roleId: role.id, roleCode: role.code }}
              submitLabel="İzni role ver"
              idPrefix={`izin-ver-${role.code}`}
              consequence={`Seçilen izin ${role.code} rolüne doğrudan verilir. Kendinizde olmayan bir izni veremezsiniz: backend aktörün izinlerini her yazımda veritabanından yeniden çözer ve 403 döndürür.`}
              fields={[
                {
                  name: "permission",
                  label: "Verilecek izin",
                  type: "select",
                  required: true,
                  hint: "Seçenekler GET /admin/permissions'tan, yani backend'in kendi kataloğundan geliyor.",
                  options: grantable.map((entry) => ({
                    value: entry.code,
                    label: `${entry.code} — ${labelOf(entry.code)}`,
                    note: noteForPermission(entry),
                  })),
                },
              ]}
              disabled={grantable.length === 0}
              disabledReason="Katalogdaki her izin bu role zaten doğrudan verilmiş."
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Kapsanan roller ({formatInteger(role.includes.length)})
          </h3>
          <p className="max-w-prose text-xs text-ink-muted">
            DAG kenarları. Kapsanan rolün bütün etkili izinleri bu role geçer; bir rol dolaylı
            olarak kendini içeremez, backend döngü yaratan bir kenarı 409 ile reddeder.
          </p>

          {role.includes.length === 0 ? (
            <p className="text-sm text-ink-muted">Bu rol başka bir rolü kapsamıyor.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {role.includes.map((included) => (
                <li
                  key={included.id}
                  className="flex flex-wrap items-center gap-3 rounded-md border border-border-subtle px-3 py-2"
                >
                  <span className="font-mono text-sm">{included.code}</span>
                  <span className="text-xs text-ink-muted">{included.name}</span>
                  <AuthorizationForm
                    action={removeRoleInclude}
                    hiddenFields={{
                      roleId: role.id,
                      roleCode: role.code,
                      includedRoleId: included.id,
                      includedRoleCode: included.code,
                    }}
                    submitLabel="Kapsamayı kaldır"
                    layout="inline"
                    tone="danger"
                    idPrefix={`kapsama-kaldir-${role.code}-${included.code}`}
                    consequence={`${role.code} artık ${included.code} rolünü kapsamaz ve onun izinlerini devralmaz. Backend, kapsanan rolün etkili izinlerinin tamamına sahip olmayan aktörü burada da reddeder.`}
                  />
                </li>
              ))}
            </ul>
          )}

          <div className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-3">
            <AuthorizationForm
              action={addRoleInclude}
              hiddenFields={{ roleId: role.id, roleCode: role.code }}
              submitLabel="Kapsamayı ekle"
              idPrefix={`kapsama-ekle-${role.code}`}
              consequence={`${role.code}, seçilen rolün bütün etkili izinlerini devralır. Döngü veya görev ayrılığı ihlali yaratan seçim backend tarafından 409 ile reddedilir.`}
              fields={[
                {
                  name: "includedRole",
                  label: "Kapsanacak rol",
                  type: "select",
                  required: true,
                  hint: "Döngü veya görev ayrılığı ihlali yaratacak roller seçilemez; backend aynı yazımları 409 ile reddeder.",
                  options: includable.map((candidate) => {
                    const cycles = wouldCycle(closures, role.code, candidate.code);
                    const violatesSeparation = wouldViolateSeparationAfterInclude(
                      graph,
                      role.code,
                      candidate.code,
                      memberRoles,
                    );

                    return {
                      value: roleOptionValue(candidate),
                      label: `${candidate.code} — ${candidate.name}`,
                      disabledReason: cycles
                        ? "döngü yaratır, backend 409 döner"
                        : violatesSeparation
                          ? "görev ayrılığını bozar; backend 409 döner"
                          : undefined,
                    };
                  }),
                },
              ]}
              disabled={includable.length === 0}
              disabledReason="Kapsanabilecek başka rol yok."
            />
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-semibold text-ink">
            Etkili izinler ({formatInteger(effective.length)})
          </h3>
          <p className="max-w-prose text-xs text-ink-muted">
            &quot;Bu rol sonuçta hangi izinlere sahip&quot;: doğrudan verilenler ile kapsama yoluyla
            gelenlerin birleşimi. İzinlerin toplandığı roller (kapanış, bu rol dâhil):{" "}
            <code className="font-mono">{closure.join(", ")}</code>. Bir küme, bir yol değil —
            DAG&apos;da aynı role birden çok yoldan ulaşılabilir.
          </p>

          {effective.length === 0 ? (
            <p className="text-sm text-ink-muted">Bu rol hiçbir izne ulaşmıyor.</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {effective.map((permission) => (
                <li key={permission}>
                  <Badge tone={inherited.includes(permission) ? "neutral" : "brand"}>
                    <span className="font-mono">{permission}</span>
                    {inherited.includes(permission) ? " (kalıtım)" : " (doğrudan)"}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </details>
  );
}

/** Panelin bildiği bir izne Türkçe ad; bilmediğini olduğu gibi yazar. */
function labelOf(permission: string): string {
  return isPermission(permission) ? permissionLabel(permission) : "Panelin tanımadığı izin";
}

/** Hassas bir izni role vermeden önce söylenmesi gereken şey. */
function noteForPermission(entry: StaffPermissionEntry): string | undefined {
  if (entry.sensitivity === "FINANCIAL") {
    return `${entry.code} finans sınıfında${entry.mutating ? " ve para hareketi yapar" : ""}. Bu rolü taşıyan herkes bunu devralır.`;
  }

  if (entry.sensitivity === "PERSONAL_DATA") {
    return `${entry.code} kişisel veri sınıfında. Denetim kaydında bu satırlar on yıl değil, 24 ay saklanır; erişimin kendisi de kayda geçer.`;
  }

  return undefined;
}

/** Değişikliklerin nereye yazıldığı, aramanın nasıl yapıldığı. */
function RoleAuditPointer() {
  return (
    <AuditPointer
      permission="role.manage"
      linkLabel="Rol grafiği değişikliklerini denetim kaydında aç"
    >
      koala-backend her <code className="font-mono">/admin/**</code> isteğini — kabul edileni de
      reddedileni de — denetim kaydına yazıyor: kim, ne zaman, hangi izin, hangi kaynak. Rol
      yazımları ayrıca <strong>öncesini ve sonrasını</strong> da damgalıyor (
      <code className="font-mono">permissions=[…]; includes=[…]</code>).
    </AuditPointer>
  );
}
