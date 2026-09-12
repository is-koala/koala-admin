import type { RoleCode } from "./role-identity";

/**
 * Rol grafiğini okumak: kapanış, döngü ve görev ayrılığı.
 *
 * Saf, ve tek import'u **tip düzeyinde**: `RoleCode` derlemeden sonra ortadan
 * kalkıyor, yani buradan tarayıcı paketine giden bir satır yok. Hem Server
 * Component'ler hem `"use client"` formları bu modülü okuyor ve içine giren her
 * şey tarayıcı paketine de girerdi — burada yalnız veri ve aritmetik var.
 *
 * ## Bu modülün yetkisi ne kadar
 *
 * Hiç. Grafiği **çözen** yer `StaffAuthorizationManager`, ve panel onun
 * cevabını (`effectiveRoles`, `effectivePermissions`) olduğu gibi gösteriyor.
 * Buradaki hesaplar yalnız **bir yazımın öncesinde** çalışıyor: operatör bir
 * kapsama eklemeden ya da bir rol atamadan önce sonucunun ne olacağını
 * görebilsin diye. Yazımın kabul edilip edilmeyeceğine backend karar verir ve
 * reddi ekranda onun cümlesiyle görünür.
 *
 * Ayrım önemli, çünkü bu hesaplar yalnız backend kuralının arayüzdeki ön
 * izlemesidir:
 *
 *  - **Döngü gerçekten reddediliyor.** `includeRole` kapanışı gezip
 *    `ConflictException(ROLE_GRAPH_WOULD_CYCLE)` fırlatıyor → 409. Buradaki
 *    {@link wouldCycle} onun aynadaki görüntüsü; bir düğmeyi önceden kapatmak
 *    için var, reddi üretmek için değil.
 *  - **Görev ayrılığı da reddediliyor.** Backend rol grafiği ve üyelik
 *    yazımlarından sonra etkilenen kapanışları yeniden çözüp ihlali 409 ile
 *    reddediyor. {@link separationVerdict} panelin geçersiz seçeneği önceden
 *    kapatabilmesi için aynı sonucu hesaplar; nihai karar değildir.
 *
 * ## Kural iki yerde bozulabiliyor, ön izlemesi de iki yerde
 *
 * Bir rolün iki dalı kapsaması ({@link separationVerdictAfterInclude}) kuralın
 * yazılı hâli, ama insanın eliyle en kolay kurulan birleşim o değil: bir
 * **kişiye** hem `TRUST_LEAD` hem `FINANCE_OFFICER` vermek. Sonuç aynı yetki
 * birleşimi ve backend onu da reddediyor. {@link membershipSeparationVerdict}
 * aynı ön izlemeyi üyelik tarafına taşıyor.
 */

/** Bir rol düğümü — `GET /admin/roles`'un tek istekte verdiği kadarı. */
export interface RoleGraphNode {
  readonly code: RoleCode;
  /** Bu rolün doğrudan kapsadığı rollerin kodları. */
  readonly includes: readonly RoleCode[];
}

/**
 * ADR-0014 §Rol grafiği'nin güven dalı ve bugünkü finans seed rolleri.
 *
 * Backend güven dalını üç sabit kodla, finans dalını ise `FINANCE_` önekiyle
 * tanıyor. Kullanıcıya gösterilen liste bugünkü Liquibase seed'ini anlatmaya
 * devam eder; karar hesabı aşağıda prefix kuralını kullanır. Rol yaratan bir uç
 * yok (`StaffRolesController` yalnız okuma ve kenar/izin yazımı sunuyor), ama
 * gelecekteki bir changeset yeni bir `FINANCE_*` rolü eklediğinde panelin
 * backend'den ayrışmaması için gösterim listesi karar kaynağı değildir.
 *
 * Tipleri `RoleCode` değil `string`: bunlar bir adres değil, karşılaştırılan
 * bir liste. Markalamak, listeye bakan her satıra bir dönüşüm eklerdi.
 */
export const TRUST_BRANCH_ROLES: readonly string[] = ["MODERATOR", "DISPUTE_HANDLER", "TRUST_LEAD"];

export const FINANCE_BRANCH_ROLES: readonly string[] = ["FINANCE_ANALYST", "FINANCE_OFFICER"];

/** `StaffSeparationOfDuties.isFinanceBranch` ile aynı çalışma zamanı kuralı. */
const FINANCE_BRANCH_ROLE_PREFIX = "FINANCE_";

/** Kuralın tek istisnası, ADR-0014'ün kendi cümlesiyle: `OWNER` hariç. */
export const SEPARATION_EXEMPT_ROLES: readonly string[] = ["OWNER"];

export type DutyBranch = "TRUST" | "FINANCE";

export const DUTY_BRANCH_LABELS: Record<DutyBranch, string> = {
  TRUST: "Güven (moderasyon / uyuşmazlık)",
  FINANCE: "Finans (ödeme / tahsilat)",
};

/** Grafiği koda göre indeksler; aşağıdaki gezinmelerin hepsi bunun üzerinde. */
function indexOf(graph: readonly RoleGraphNode[]): Map<string, readonly RoleCode[]> {
  return new Map(graph.map((node) => [node.code, node.includes]));
}

function sorted(codes: Iterable<RoleCode>): RoleCode[] {
  return [...codes].sort((a, b) => a.localeCompare(b, "tr"));
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
  root: RoleCode,
  extraEdge?: { readonly from: RoleCode; readonly to: RoleCode },
): RoleCode[] {
  const edges = indexOf(graph);
  const reached = new Set<RoleCode>([root]);
  let frontier = [root];

  while (frontier.length > 0) {
    const next: RoleCode[] = [];

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

  return sorted(reached);
}

/** Her rolün kapanışı, koda göre. */
export type RoleClosures = ReadonlyMap<RoleCode, readonly RoleCode[]>;

/**
 * Grafiğin bütün kapanışları — rol başına **bir** gezinti.
 *
 * Bir ekran aynı kapanışı defalarca soruyor: tablodaki satır, rol detayı,
 * etkili izin listesi ve her kapsama adayının döngü kontrolü. Hepsi tek bir
 * cevabı paylaşsın diye kapanışlar bir kez burada çıkarılıyor;
 * {@link wouldCycle} de grafiği değil bu haritayı alıyor, yani "bir kez hesapla"
 * bir disiplin değil imzanın kendisi.
 */
export function closuresWithSelf(graph: readonly RoleGraphNode[]): RoleClosures {
  return new Map(graph.map((node) => [node.code, closureWithSelf(graph, node.code)]));
}

/**
 * `parent`'ın `child`'ı kapsaması bir döngü yaratır mı?
 *
 * `includeRole`'ün koşulunun aynısı: kendini kapsamak, ya da `child`'ın
 * kapanışının `parent`'ı içermesi. Backend bunu 409 ile reddediyor; bu
 * fonksiyon yalnız o reddi **önceden görünür** kılıyor.
 *
 * Yön önemli ve tek yönlü: `parent`'ın `child`'a **zaten** ulaşıyor olması bir
 * döngü değildir. `TRUST_LEAD → SUPPORT_AGENT` böyle bir kenar (TRUST_LEAD ona
 * MODERATOR üzerinden zaten ulaşıyor) ve backend onu kabul ediyor — burada
 * `true` dönmek, açık bir kapıyı ekranda kapatmak olurdu.
 */
export function wouldCycle(closures: RoleClosures, parent: RoleCode, child: RoleCode): boolean {
  return parent === child || (closures.get(child) ?? [child]).includes(parent);
}

export interface SeparationVerdict {
  /** Kapanışın dokunduğu dallar. İki tanesi varsa kural konuşuyor demektir. */
  readonly branches: readonly DutyBranch[];
  /** `OWNER` — kuralın yazılı istisnası. */
  readonly exempt: boolean;
  /** İki dalı birden kapsıyor ve istisna değil. */
  readonly violates: boolean;
}

function branchesOf(closure: readonly RoleCode[]): DutyBranch[] {
  const branches: DutyBranch[] = [];
  if (closure.some((code) => TRUST_BRANCH_ROLES.includes(code))) branches.push("TRUST");
  if (closure.some((code) => code.startsWith(FINANCE_BRANCH_ROLE_PREFIX))) branches.push("FINANCE");
  return branches;
}

/**
 * Bir rolün (ya da yazılmamış bir kenarın sonucunun) görev ayrılığı ön izlemesi.
 *
 * Dönen şey nihai karar değil bir okuma. Çağıran reddedileceği belli seçeneği
 * kapatır; bayat veya doğrudan gönderilmiş isteği backend yeniden denetler.
 */
export function separationVerdict(role: RoleCode, closure: readonly RoleCode[]): SeparationVerdict {
  const branches = branchesOf(closure);
  const exempt = SEPARATION_EXEMPT_ROLES.includes(role);

  return { branches, exempt, violates: branches.length === 2 && !exempt };
}

/** `separationVerdict`, grafiği kendisi gezerek. */
export function separationVerdictOf(
  graph: readonly RoleGraphNode[],
  role: RoleCode,
): SeparationVerdict {
  return separationVerdict(role, closureWithSelf(graph, role));
}

/**
 * `parent ← child` kenarı yazılsaydı görev ayrılığı ne derdi?
 *
 * Kapsama ekleme formundaki seçilemez seçenek ve açıklaması bundan gelir.
 */
export function separationVerdictAfterInclude(
  graph: readonly RoleGraphNode[],
  parent: RoleCode,
  child: RoleCode,
): SeparationVerdict {
  return separationVerdict(parent, closureWithSelf(graph, parent, { from: parent, to: child }));
}

/**
 * Yeni kenar, `parent`'a ulaşan rollerden herhangi birini iki dala taşır mı?
 *
 * Backend yalnız doğrudan değiştirilen rolü değil, ona ulaşan bütün üst rolleri
 * yeniden denetler. Örneğin dal dışı SUPPORT_AGENT'a finans rolü eklemek kendi
 * başına geçerli görünür; ona ulaşan TRUST_LEAD'i iki dala taşıdığı için yine
 * reddedilir. Alakasız, önceden bozuk bir rol bu seçeneği kapatmasın diye yalnız
 * `parent`'a ulaşan kapanışlar incelenir.
 */
export function wouldViolateSeparationAfterInclude(
  graph: readonly RoleGraphNode[],
  parent: RoleCode,
  child: RoleCode,
  memberRoles: readonly (readonly RoleCode[])[] = [],
): boolean {
  const roleWouldViolate = graph.some((node) => {
    const reachesParent = closureWithSelf(graph, node.code).includes(parent);
    if (!reachesParent) return false;

    const closureAfterInclude = closureWithSelf(graph, node.code, { from: parent, to: child });
    return separationVerdict(node.code, closureAfterInclude).violates;
  });

  if (roleWouldViolate) return true;

  return memberRoles.some((held) => {
    const affected = held.some((role) => closureWithSelf(graph, role).includes(parent));
    if (!affected) return false;

    const reachedAfterInclude = new Set<RoleCode>();
    for (const role of held) {
      for (const reached of closureWithSelf(graph, role, { from: parent, to: child })) {
        reachedAfterInclude.add(reached);
      }
    }

    return membershipSeparationVerdict([...reachedAfterInclude]).violates;
  });
}

/** Teşhisi bir cümleye çevirir; `null` "söylenecek bir şey yok" demek. */
export function separationSentence(role: RoleCode, verdict: SeparationVerdict): string | null {
  if (verdict.branches.length < 2) return null;

  if (verdict.exempt) {
    return `${role} her iki dalı da kapsıyor. ADR-0014 bunu yalnız OWNER için serbest bırakır; kuralın tek yazılı istisnası budur.`;
  }

  return `${role} hem güven dalını (${TRUST_BRANCH_ROLES.join(", ")}) hem finans dalını (FINANCE_*; bugünkü roller: ${FINANCE_BRANCH_ROLES.join(", ")}) kapsıyor. ADR-0014 §Rol grafiği bunu OWNER dışında yasaklar. Backend yeni rol grafiği yazımlarında bu birleşimi 409 ile reddeder; mevcut bir ihlal görüyorsanız kapsamalar ayrılmalıdır.`;
}

/* -------------------------------------------------------------------------- */
/* Üyelik tarafı: aynı kural, insanın eliyle en kolay kurulan hâli             */
/* -------------------------------------------------------------------------- */

/**
 * Bir kişinin taşıdığı rollerin **birleşik** kapanışı.
 *
 * `StaffMemberDto.roles` yalnız doğrudan üyelikleri veriyor; kişinin gerçekte
 * neye ulaştığı, o rollerin kapanışlarının birleşimi — `/admin/me`'nin `roles`
 * alanının verdiği şeyin aynısı.
 *
 * Grafikte tanınmayan bir rol yalnız kendisine ulaşır. Bu, grafiğin hiç
 * okunamadığı durumu da kapsıyor: boş bir harita ile teşhis **doğrudan**
 * rollere iner, yani `TRUST_LEAD` + `FINANCE_OFFICER` birleşimi grafik
 * olmadan da görülür; yalnız kalıtımla gelen dallar görünmez olur.
 */
export function membershipClosure(closures: RoleClosures, held: readonly RoleCode[]): RoleCode[] {
  const reached = new Set<RoleCode>();
  for (const role of held) {
    for (const code of closures.get(role) ?? [role]) reached.add(code);
  }

  return sorted(reached);
}

/**
 * Bir kişinin rollerinin görev ayrılığı ön izlemesi.
 *
 * Rol tarafındaki {@link separationVerdict}'ten tek farkı istisnanın nereden
 * okunduğu: orada sorulan "bu rol OWNER mı", burada "bu kişi OWNER'a ulaşıyor
 * mu". Bir kişiye OWNER verilmişse iki dalı kapsaması ADR-0014'ün yazılı
 * istisnası; iki ayrı dal rolünü yan yana taşıması değil.
 */
export function membershipSeparationVerdict(closure: readonly RoleCode[]): SeparationVerdict {
  const branches = branchesOf(closure);
  const exempt = closure.some((code) => SEPARATION_EXEMPT_ROLES.includes(code));

  return { branches, exempt, violates: branches.length === 2 && !exempt };
}

/** Bir rol atansaydı üyelik tarafında görev ayrılığı ne derdi? */
export function membershipSeparationVerdictAfterGrant(
  closures: RoleClosures,
  held: readonly RoleCode[],
  granted: RoleCode,
): SeparationVerdict {
  return membershipSeparationVerdict(membershipClosure(closures, [...held, granted]));
}

/**
 * Üyelik teşhisini bir cümleye çevirir; `null` "söylenecek bir şey yok" demek.
 *
 * Rol tarafındaki cümleden ayrı yazılı, çünkü söylediği şey ayrı: orada bir
 * rolün tanımı kuralı bozuyor, burada iki ayrı rolün **aynı kişide
 * buluşması**. Kural aynı, ihlali kuran el farklı.
 */
export function membershipSeparationSentence(
  label: string,
  verdict: SeparationVerdict,
): string | null {
  if (verdict.branches.length < 2) return null;

  if (verdict.exempt) {
    return `${label} her iki dala da OWNER üzerinden ulaşıyor. ADR-0014 kuralın tek yazılı istisnası olarak OWNER'ı bırakır.`;
  }

  return `${label} taşıdığı rollerle hem güven dalına (${TRUST_BRANCH_ROLES.join(", ")}) hem finans dalına (FINANCE_*; bugünkü roller: ${FINANCE_BRANCH_ROLES.join(", ")}) ulaşıyor. ADR-0014 §Rol grafiği bu birleşimi OWNER dışında yasaklar. Backend yeni rol atamalarında bu birleşimi 409 ile reddeder; mevcut bir ihlal görüyorsanız roller ayrılmalıdır.`;
}
