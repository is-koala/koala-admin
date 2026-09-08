import type { Metadata } from "next";
import Link from "next/link";

import { AuthorizationForm } from "@/components/panel/authz/authorization-form";
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
  DUTY_BRANCH_LABELS,
  FINANCE_BRANCH_ROLES,
  TRUST_BRANCH_ROLES,
  closureWithSelf,
  separationSentence,
  separationVerdict,
  separationVerdictAfterInclude,
  wouldCycle,
  type RoleGraphNode,
  type SeparationVerdict,
} from "@/lib/role-graph";
import { QueueLoadFailure } from "@/components/panel/queue";
import {
  ROLE_GRAPH_BACKEND_GAPS,
  getStaffPermissionCatalog,
  getStaffRoles,
  type StaffPermissionEntry,
  type StaffRole,
} from "@/server/api/staff-roles";
import { getKoalaAccessToken } from "@/server/auth/session";
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
 *     tanımını uyguluyor (kapanış üzerindeki doğrudan izinlerin birleşimi) ve
 *     `roles.test.tsx` bunu backend'in `effectivePermissions` cevabına karşı
 *     sabitliyor. Burada hesaplanan sayı kimseye bir kapı açmıyor: neye izin
 *     verileceğine hâlâ her istekte backend karar veriyor (ADR-0010, ADR-0014).
 *     Alternatif — rol başına `GET /admin/roles/{roleId}` — on rol için on
 *     istekti; gerekçe `src/server/api/staff-roles.ts`'te yazılı.
 *
 * ## Görev ayrılığı: gösteriliyor, uygulanmıyor
 *
 * ADR-0014 §Rol grafiği "OWNER dışında hiçbir rol hem trust hem finans dalını
 * kapsayamaz" diyor. koala-backend bunu **çalışma anında uygulamıyor**:
 * `includeRole` yalnız döngüyü ve "sahip olmadığın izni veremezsin" kuralını
 * denetliyor; görev ayrılığı yalnız `StaffRoleGraphSeedTest`'te ve o test seed
 * XML'ini okuyor.
 *
 * Panel bu yüzden kuralı **teşhis olarak** gösteriyor ve istemcide reddetmiyor.
 * Reddetseydi, aynı yazım `curl` ile geçerken ekran onu engellediğini sanırdı —
 * yani ekran yalan söylerdi. Eksik `ROLE_GRAPH_BACKEND_GAPS`'in ilk maddesi
 * olarak sayfada yazılı.
 */
export default async function RolesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Roller ve izinler</h1>
        <p className="max-w-prose text-sm text-ink-muted">
          Rol→izin grafiği ve roller arası kapsama (DAG).{" "}
          <code className="font-mono">role.manage</code> izni gerektirir. İzinler token&apos;a
          gömülmez; her istekte veritabanından çözülür, bu yüzden burada yapılan bir değişiklik
          ilgili personelin <strong>bir sonraki isteğinde</strong> geçerlidir.
        </p>
      </header>

      <RequirePermission permission="role.manage">
        <RoleGraph />
      </RequirePermission>
    </div>
  );
}

async function RoleGraph() {
  const accessToken = await getKoalaAccessToken();

  let roles: StaffRole[];
  let catalog: StaffPermissionEntry[];
  try {
    /**
     * İki istek, paralel. `GET /admin/roles` grafiğin **tamamını** tek cevapta
     * veriyor (controller'ın kendi belgesi böyle vaat ediyor), bu yüzden
     * kapanış, döngü ve görev ayrılığı hesaplarının hiçbiri ek istek istemiyor.
     */
    [roles, catalog] = await Promise.all([
      getStaffRoles(accessToken),
      getStaffPermissionCatalog(accessToken),
    ]);
  } catch (error) {
    return (
      <div className="flex flex-col gap-4">
        <QueueLoadFailure
          subject="Rol grafiği"
          permission="role.manage"
          failure={classifyQueueFailure(error)}
        />
        <BackendGaps />
      </div>
    );
  }

  const graph: RoleGraphNode[] = roles.map((role) => ({
    code: role.code,
    includes: role.includes.map((included) => included.code),
  }));

  return (
    <div className="flex flex-col gap-6">
      <SeparationNotice />

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
              {roles.map((role) => {
                const closure = closureWithSelf(graph, role.code);
                const verdict = separationVerdict(role.code, closure);
                const effective = effectivePermissionsOf(role, roles);

                return (
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
                );
              })}
            </TableBody>
          </Table>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-semibold">Rol detayları</h2>
            {roles.map((role) => (
              <RoleDetail key={role.id} role={role} roles={roles} graph={graph} catalog={catalog} />
            ))}
          </section>
        </>
      )}

      <AuditPointer />
      <BackendGaps />
    </div>
  );
}

/**
 * Etkili izinler — `GET /admin/roles`'un verdiği kenarlardan toplanmış.
 *
 * `StaffAuthorizationManager.graph()` ile **aynı** tanım: doğrudan olanlar ∪
 * ulaşılan her rolün doğrudan olanları. Backend bunu `effectivePermissions`
 * olarak hazır veriyor ama yalnız `GET /admin/roles/{roleId}`'de, yani rol
 * başına bir istekle; gerekçe `src/server/api/staff-roles.ts`'te, eşitliğin
 * kanıtı `roles.test.tsx`'te.
 *
 * Bu bir yetkilendirme kararı değil, bir gösterim: kimseye bir kapı açmıyor,
 * yalnız operatörün az önce yaptığı değişikliğin sonucunu yazdırıyor. Yanlış
 * olsaydı sonucu yanlış bir sayı olurdu, fazladan bir yetki değil.
 */
function effectivePermissionsOf(role: StaffRole, roles: readonly StaffRole[]): string[] {
  const byCode = new Map(roles.map((entry) => [entry.code, entry]));
  const graph: RoleGraphNode[] = roles.map((entry) => ({
    code: entry.code,
    includes: entry.includes.map((included) => included.code),
  }));

  const permissions = new Set<string>();
  for (const code of closureWithSelf(graph, role.code)) {
    for (const permission of byCode.get(code)?.permissions ?? []) permissions.add(permission);
  }

  return [...permissions].sort((a, b) => a.localeCompare(b, "tr"));
}

function SeparationBadge({ verdict }: { verdict: SeparationVerdict }) {
  const only = verdict.branches.length === 1 ? verdict.branches[0] : undefined;

  if (only !== undefined) {
    return <Badge tone="neutral">Yalnız {DUTY_BRANCH_LABELS[only]}</Badge>;
  }

  if (verdict.branches.length === 0) {
    return <Badge tone="neutral">Dal dışı</Badge>;
  }

  return verdict.exempt ? (
    <Badge tone="brand">İki dal — yazılı istisna</Badge>
  ) : (
    <Badge tone="danger">İki dal — kural ihlali</Badge>
  );
}

/**
 * Kuralın durumu, sayfanın en üstünde ve tam olarak olduğu gibi.
 *
 * Bu kutu bir uyarı değil bir düzeltme: issue'nun kabul maddesi "görev
 * ayrılığını bozan bir birleştirme reddediliyor" diyor ve **reddedilmiyor**.
 * Operatörün ekranda bir "ihlal" rozeti görüp backend'in o yazımı durduracağını
 * sanması, kuralın olmadığını hiç bilmemekten daha kötü olurdu.
 */
function SeparationNotice() {
  return (
    <div className="rounded-lg border border-warning/30 bg-warning-soft px-4 py-3">
      <p className="text-sm font-semibold text-warning">
        Görev ayrılığı kuralı burada gösterilir, uygulanmaz.
      </p>
      <p className="max-w-prose text-sm text-ink">
        ADR-0014 §Rol grafiği&apos;nin kuralı şu:{" "}
        <strong>
          OWNER dışında hiçbir rol hem güven dalını ({TRUST_BRANCH_ROLES.join(", ")}) hem finans
          dalını ({FINANCE_BRANCH_ROLES.join(", ")}) kapsayamaz.
        </strong>{" "}
        koala-backend bu kuralı <strong>çalışma anında uygulamıyor</strong>:{" "}
        <code className="font-mono">StaffAuthorizationManager.includeRole</code> yalnız döngüyü ve
        &quot;sahip olmadığın izni veremezsin&quot; kuralını denetliyor. Kural yalnız{" "}
        <code className="font-mono">StaffRoleGraphSeedTest</code>&apos;te yaşıyor ve o test seed XML
        dosyasını okuyor — veritabanını değil, bir isteği hiç değil.
      </p>
      <p className="mt-2 max-w-prose text-sm text-ink">
        Yani aşağıdaki &quot;kural ihlali&quot; rozetleri bir <em>teşhis</em>; backend o kapsamayı{" "}
        <strong>kabul eder</strong>. Panel bunu istemcide reddetmiyor, çünkü reddetseydi aynı yazım{" "}
        <code className="font-mono">curl</code> ile geçerken ekran onu engellediğini sanırdı.
      </p>
    </div>
  );
}

function RoleDetail({
  role,
  roles,
  graph,
  catalog,
}: {
  role: StaffRole;
  roles: readonly StaffRole[];
  graph: readonly RoleGraphNode[];
  catalog: readonly StaffPermissionEntry[];
}) {
  const closure = closureWithSelf(graph, role.code);
  const verdict = separationVerdict(role.code, closure);
  const sentence = separationSentence(role.code, verdict);
  const effective = effectivePermissionsOf(role, roles);
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
            {verdict.violates
              ? " Backend bu durumu reddetmez; kural yalnız seed testinde yaşıyor."
              : null}
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
              consequence={`${role.code}, seçilen rolün bütün etkili izinlerini devralır. Döngü yaratan bir seçim backend tarafından 409 ile reddedilir; görev ayrılığını bozan bir seçim ise REDDEDİLMEZ — yalnız aşağıda yazar.`}
              fields={[
                {
                  name: "includedRole",
                  label: "Kapsanacak rol",
                  type: "select",
                  required: true,
                  hint: "Döngü yaratacak roller seçilemez. İki dalı birleştirecek olanlar seçilebilir, çünkü backend onları kabul eder.",
                  options: includable.map((candidate) => ({
                    value: `${candidate.id}:${candidate.code}`,
                    label: `${candidate.code} — ${candidate.name}`,
                    disabledReason: wouldCycle(graph, role.code, candidate.code)
                      ? "döngü yaratır, backend 409 döner"
                      : undefined,
                    note: includeNote(graph, role.code, candidate.code),
                  })),
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

/** Bir kapsamanın görev ayrılığına ne yapacağı — yazılmadan önce. */
function includeNote(
  graph: readonly RoleGraphNode[],
  parent: string,
  child: string,
): string | undefined {
  if (wouldCycle(graph, parent, child)) return undefined;

  const after = separationVerdictAfterInclude(graph, parent, child);
  if (!after.violates) return undefined;

  return `Bu kapsama ${parent} rolünü hem güven hem finans dalına sokar; ADR-0014 §Rol grafiği bunu OWNER dışında yasaklar. Backend bu yazımı yine de KABUL EDER — kural çalışma anında uygulanmıyor.`;
}

/** Değişikliklerin nereye yazıldığı, aramanın nasıl yapıldığı. */
function AuditPointer() {
  return (
    <section className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3">
      <h2 className="text-sm font-semibold text-ink">Her değişiklik denetim kaydında</h2>
      <p className="max-w-prose text-xs text-ink-muted">
        koala-backend her <code className="font-mono">/admin/**</code> isteğini — kabul edileni de
        reddedileni de — denetim kaydına yazıyor: kim, ne zaman, hangi izin, hangi kaynak. Rol
        yazımları ayrıca <strong>öncesini ve sonrasını</strong> da damgalıyor (
        <code className="font-mono">permissions=[…]; includes=[…]</code>).
      </p>
      <p className="text-xs text-ink-muted">
        <Link
          href={{ pathname: "/audit-log", query: { permission: "role.manage" } }}
          className="text-brand hover:underline"
        >
          Rol grafiği değişikliklerini denetim kaydında aç
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
        Backend&apos;in veremedikleri ({formatInteger(ROLE_GRAPH_BACKEND_GAPS.length)})
      </h2>
      <p className="max-w-prose text-xs text-ink-muted">
        koala-admin#9&apos;un istediği ama <code className="font-mono">StaffRolesController</code>{" "}
        ve <code className="font-mono">StaffAuthorizationManager</code>&apos;ın bugün
        karşılayamadığı maddeler. Panel bunları taklit etmiyor.
      </p>
      <dl className="flex flex-col gap-2">
        {ROLE_GRAPH_BACKEND_GAPS.map((gap) => (
          <div key={gap.id} className="flex flex-col">
            <dt className="text-sm font-medium text-ink">{gap.title}</dt>
            <dd className="max-w-prose text-xs text-ink-muted">{gap.detail}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
