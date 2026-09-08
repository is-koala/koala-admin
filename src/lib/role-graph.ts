/**
 * Rol grafiğini okumak: kapanış, döngü ve görev ayrılığı.
 *
 * Import'suz ve saf. Hem Server Component'ler hem `"use client"` formları bu
 * modülü okuyor, bu yüzden içine giren her şey tarayıcı paketine de girer —
 * burada yalnız veri ve aritmetik var.
 *
 * ## Bu modülün yetkisi ne kadar
 *
 * Hiç. Grafiği **çözen** yer `StaffAuthorizationManager`, ve panel onun
 * cevabını (`effectiveRoles`, `effectivePermissions`) olduğu gibi gösteriyor.
 * Buradaki hesaplar yalnız **bir yazımın öncesinde** çalışıyor: operatör bir
 * kapsama eklemeden önce sonucunun ne olacağını görebilsin diye. Yazımın
 * kabul edilip edilmeyeceğine backend karar verir ve reddi ekranda onun
 * cümlesiyle görünür.
 *
 * Ayrım önemli, çünkü iki kuralın backend'deki durumu **aynı değil**:
 *
 *  - **Döngü gerçekten reddediliyor.** `includeRole` kapanışı gezip
 *    `ConflictException(ROLE_GRAPH_WOULD_CYCLE)` fırlatıyor → 409. Buradaki
 *    {@link wouldCycle} onun aynadaki görüntüsü; bir düğmeyi önceden kapatmak
 *    için var, reddi üretmek için değil.
 *  - **Görev ayrılığı reddedilmiyor.** ADR-0014 §Rol grafiği kuralı yazıyor
 *    ama `src/main` içinde onu uygulayan tek satır yok: kural yalnız
 *    `StaffRoleGraphSeedTest`'te, ve o test seed XML'ini okuyor — çalışan
 *    veritabanını değil, bir isteği hiç değil. Yani panel bir ihlali
 *    *gösterebilir*, **engelleyemez**; engelliyormuş gibi yapmak da yanlış
 *    olurdu, çünkü backend o yazımı kabul edecek. {@link separationVerdict}
 *    bu yüzden bir "red" değil bir **teşhis** döndürüyor.
 */

/** Bir rol düğümü — `GET /admin/roles`'un tek istekte verdiği kadarı. */
export interface RoleGraphNode {
  readonly code: string;
  /** Bu rolün doğrudan kapsadığı rollerin kodları. */
  readonly includes: readonly string[];
}

/**
 * ADR-0014 §Rol grafiği'nin iki dalı, `StaffRoleGraphSeedTest`'ten birebir.
 *
 * Rol kodları sabit yazılı, çünkü backend'de de öyle: rol yaratan bir uç yok
 * (`StaffRolesController` yalnız okuma ve kenar/izin yazımı sunuyor), grafiğin
 * kendisi Liquibase seed'iyle geliyor. Yeni bir rol eklendiği gün bu iki küme
 * de elle güncellenmek zorunda — backend tarafındaki test de aynı kısıtla
 * yaşıyor ve bu, kuralın zayıf tarafı olarak burada yazılı dursun.
 */
export const TRUST_BRANCH_ROLES: readonly string[] = ["MODERATOR", "DISPUTE_HANDLER", "TRUST_LEAD"];

export const FINANCE_BRANCH_ROLES: readonly string[] = ["FINANCE_ANALYST", "FINANCE_OFFICER"];

/** Kuralın tek istisnası, ADR-0014'ün kendi cümlesiyle: `OWNER` hariç. */
export const SEPARATION_EXEMPT_ROLES: readonly string[] = ["OWNER"];

export type DutyBranch = "TRUST" | "FINANCE";

export const DUTY_BRANCH_LABELS: Record<DutyBranch, string> = {
  TRUST: "Güven (moderasyon / uyuşmazlık)",
  FINANCE: "Finans (ödeme / tahsilat)",
};

/** Grafiği koda göre indeksler; aşağıdaki gezinmelerin hepsi bunun üzerinde. */
function indexOf(graph: readonly RoleGraphNode[]): Map<string, readonly string[]> {
  return new Map(graph.map((node) => [node.code, node.includes]));
}

/**
 * `root`'un kapsama kapanışı — **kendisi dâhil**.
 *
 * Backend'in `effectiveRoles` alanı kendisini *dışarıda* bırakıyor; görev
 * ayrılığı sorusu ise "bu rol hangi dalları kapsıyor" olduğu için kendisini de
 * saymak zorunda (`StaffRoleGraphSeedTest` de `closure.add(role)` yapıyor).
 * İki farklı tanımı tek bir ada yüklememek için buradaki ad `withSelf`.
 */
export function closureWithSelf(
  graph: readonly RoleGraphNode[],
  root: string,
  extraEdge?: { readonly from: string; readonly to: string },
): string[] {
  const edges = indexOf(graph);
  const reached = new Set<string>([root]);
  let frontier = [root];

  while (frontier.length > 0) {
    const next: string[] = [];

    for (const code of frontier) {
      const children = [...(edges.get(code) ?? [])];
      // Henüz yazılmamış bir kenarın sonucunu sormanın yolu: onu geziye ekle.
      if (extraEdge !== undefined && extraEdge.from === code) children.push(extraEdge.to);

      for (const child of children) {
        if (!reached.has(child)) {
          reached.add(child);
          next.push(child);
        }
      }
    }

    frontier = next;
  }

  return [...reached].sort((a, b) => a.localeCompare(b, "tr"));
}

/**
 * `parent`'ın `child`'ı kapsaması bir döngü yaratır mı?
 *
 * `includeRole`'ün koşulunun aynısı: kendini kapsamak, ya da `child`'ın
 * kapanışının `parent`'ı içermesi. Backend bunu 409 ile reddediyor; bu
 * fonksiyon yalnız o reddi **önceden görünür** kılıyor.
 */
export function wouldCycle(
  graph: readonly RoleGraphNode[],
  parent: string,
  child: string,
): boolean {
  return parent === child || closureWithSelf(graph, child).includes(parent);
}

export interface SeparationVerdict {
  /** Kapanışın dokunduğu dallar. İki tanesi varsa kural konuşuyor demektir. */
  readonly branches: readonly DutyBranch[];
  /** `OWNER` — kuralın yazılı istisnası. */
  readonly exempt: boolean;
  /** İki dalı birden kapsıyor ve istisna değil. */
  readonly violates: boolean;
}

/**
 * Bir rolün (ya da yazılmamış bir kenarın sonucunun) görev ayrılığı teşhisi.
 *
 * Dönen şey bir karar değil bir okuma. Çağıranın işi bunu ekranda söylemek;
 * bir isteği durdurmak **değil** — backend o isteği kabul edecek ve panelin
 * onu durdurması, var olmayan bir kuralı varmış gibi göstermek olurdu.
 */
export function separationVerdict(role: string, closure: readonly string[]): SeparationVerdict {
  const branches: DutyBranch[] = [];
  if (closure.some((code) => TRUST_BRANCH_ROLES.includes(code))) branches.push("TRUST");
  if (closure.some((code) => FINANCE_BRANCH_ROLES.includes(code))) branches.push("FINANCE");

  const exempt = SEPARATION_EXEMPT_ROLES.includes(role);

  return { branches, exempt, violates: branches.length === 2 && !exempt };
}

/** `separationVerdict`, grafiği kendisi gezerek. */
export function separationVerdictOf(
  graph: readonly RoleGraphNode[],
  role: string,
): SeparationVerdict {
  return separationVerdict(role, closureWithSelf(graph, role));
}

/**
 * `parent ← child` kenarı yazılsaydı görev ayrılığı ne derdi?
 *
 * Kapsama ekleme formunun yanında gösterilen uyarı bundan geliyor. Uyarı
 * *uyarıdır*: form yine gönderilebilir, çünkü backend onu kabul edecek ve
 * panelin burada durması, olmayan bir kapıyı varmış gibi çizmek olurdu.
 */
export function separationVerdictAfterInclude(
  graph: readonly RoleGraphNode[],
  parent: string,
  child: string,
): SeparationVerdict {
  return separationVerdict(parent, closureWithSelf(graph, parent, { from: parent, to: child }));
}

/** Teşhisi bir cümleye çevirir; `null` "söylenecek bir şey yok" demek. */
export function separationSentence(role: string, verdict: SeparationVerdict): string | null {
  if (verdict.branches.length < 2) return null;

  if (verdict.exempt) {
    return `${role} her iki dalı da kapsıyor. ADR-0014 bunu yalnız OWNER için serbest bırakır; kuralın tek yazılı istisnası budur.`;
  }

  return `${role} hem güven dalını (${TRUST_BRANCH_ROLES.join(", ")}) hem finans dalını (${FINANCE_BRANCH_ROLES.join(", ")}) kapsıyor. ADR-0014 §Rol grafiği bunu OWNER dışında yasaklar.`;
}
