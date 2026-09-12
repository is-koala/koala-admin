import { describe, expect, it } from "vitest";

import {
  FINANCE_BRANCH_ROLES,
  SEPARATION_EXEMPT_ROLES,
  TRUST_BRANCH_ROLES,
  closureWithSelf,
  closuresWithSelf,
  membershipClosure,
  membershipSeparationSentence,
  membershipSeparationVerdict,
  membershipSeparationVerdictAfterGrant,
  separationSentence,
  separationVerdict,
  separationVerdictAfterInclude,
  separationVerdictOf,
  wouldCycle,
  wouldViolateSeparationAfterInclude,
  type RoleGraphNode,
} from "./role-graph";
import { asRoleCode } from "./role-identity";

/**
 * Grafiğin okunması — ve okunmasının **karar vermemesi**.
 *
 * Buradaki testler iki farklı şeyi kanıtlıyor ve ikisini karıştırmamak bu
 * dosyanın bütün mesele:
 *
 *  - `wouldCycle`, backend'in 409 ile reddettiği durumun aynadaki görüntüsü.
 *    Yanlış olursa bir düğme gereksiz yere kapanır; kimse yetki kazanmaz.
 *  - `separationVerdict`, backend'in 409 ile reddettiği görev ayrılığı
 *    kuralının ön izlemesi. Yanlış olursa seçenek gereksiz yere açılır veya
 *    kapanır; yazımın nihai kararını yine backend verir.
 *
 * Hiçbiri bir kapı değil. Kapıyı ölçen dosya `administration.test.ts` ve orada
 * ölçü birimi istek sayısı.
 */

/** Rol kodu bir dize değil `RoleCode`; testlerde de öyle. */
const role = asRoleCode;

function node(code: string, ...includes: string[]): RoleGraphNode {
  return { code: asRoleCode(code), includes: includes.map(asRoleCode) };
}

/** ADR-0014 §Rol grafiği'nin seed'i, kenarlarıyla. */
const SEEDED: RoleGraphNode[] = [
  node("CATALOG_EDITOR"),
  node("SUPPORT_AGENT"),
  node("FINANCE_ANALYST"),
  node("AUDITOR"),
  node("MODERATOR", "SUPPORT_AGENT"),
  node("DISPUTE_HANDLER", "SUPPORT_AGENT"),
  node("COMPANY_APPROVER", "SUPPORT_AGENT"),
  node("TRUST_LEAD", "MODERATOR", "DISPUTE_HANDLER"),
  node("FINANCE_OFFICER", "FINANCE_ANALYST"),
  node("OWNER", "CATALOG_EDITOR", "TRUST_LEAD", "COMPANY_APPROVER", "FINANCE_OFFICER", "AUDITOR"),
];

const SEEDED_CLOSURES = closuresWithSelf(SEEDED);

describe("kapanış, kendisi dâhil", () => {
  it("TRUST_LEAD'in iki dalını birleştirip SUPPORT_AGENT'a iniyor", () => {
    // Bunun neden ağaç değil DAG olduğunun sebebi: SUPPORT_AGENT'a iki ayrı
    // yoldan (MODERATOR ve DISPUTE_HANDLER) ulaşılıyor ve bir kez sayılıyor.
    expect(closureWithSelf(SEEDED, role("TRUST_LEAD"))).toEqual([
      "DISPUTE_HANDLER",
      "MODERATOR",
      "SUPPORT_AGENT",
      "TRUST_LEAD",
    ]);
  });

  it("yaprak bir rolde yalnız kendisini döndürüyor", () => {
    expect(closureWithSelf(SEEDED, role("AUDITOR"))).toEqual(["AUDITOR"]);
  });

  it("OWNER'dan on rolün tamamına ulaşıyor", () => {
    expect(closureWithSelf(SEEDED, role("OWNER"))).toHaveLength(SEEDED.length);
  });

  it("henüz yazılmamış bir kenarı geziye katabiliyor", () => {
    // "Bu kapsamayı eklesem ne olur" sorusunun cevabı; hiçbir şey yazılmıyor.
    const before = closureWithSelf(SEEDED, role("AUDITOR"));
    const after = closureWithSelf(SEEDED, role("AUDITOR"), {
      from: role("AUDITOR"),
      to: role("FINANCE_OFFICER"),
    });

    expect(before).toEqual(["AUDITOR"]);
    expect(after).toEqual(["AUDITOR", "FINANCE_ANALYST", "FINANCE_OFFICER"]);
  });

  it("bir döngüde sonsuza kadar dönmüyor", () => {
    // Backend böyle bir grafiğe izin vermiyor, ama panel onu bir cevaptan
    // okuyor: bozuk bir veri, ekranı kilitleyen bir döngüye dönüşmemeli.
    const cyclic: RoleGraphNode[] = [node("A", "B"), node("B", "A")];

    expect(closureWithSelf(cyclic, role("A"))).toEqual(["A", "B"]);
  });

  it("grafikte olmayan bir rolde yalnız kendisini döndürüyor", () => {
    expect(closureWithSelf(SEEDED, role("YOK_BÖYLE_BİR_ROL"))).toEqual(["YOK_BÖYLE_BİR_ROL"]);
  });

  it("bütün kapanışları tek haritada, rol başına bir kez veriyor", () => {
    // Ekranın aynı kapanışı beş yerde sorması, grafiği beş kez gezmesini
    // gerektirmesin diye.
    expect([...SEEDED_CLOSURES.keys()].sort()).toEqual(
      SEEDED.map((entry) => entry.code as string).sort(),
    );
    expect(SEEDED_CLOSURES.get(role("TRUST_LEAD"))).toEqual(
      closureWithSelf(SEEDED, role("TRUST_LEAD")),
    );
  });
});

describe("döngü uyarısı, backend'in 409'unun aynası", () => {
  it("bir rolün kendini kapsamasını döngü sayıyor", () => {
    expect(wouldCycle(SEEDED_CLOSURES, role("TRUST_LEAD"), role("TRUST_LEAD"))).toBe(true);
  });

  it("dolaylı döngüyü de görüyor", () => {
    // SUPPORT_AGENT, TRUST_LEAD'i kapsasaydı: TRUST_LEAD → MODERATOR →
    // SUPPORT_AGENT → TRUST_LEAD. Backend'in `closureOf(child).contains(parent)`
    // koşulu tam olarak bu.
    expect(wouldCycle(SEEDED_CLOSURES, role("SUPPORT_AGENT"), role("TRUST_LEAD"))).toBe(true);
    expect(wouldCycle(SEEDED_CLOSURES, role("SUPPORT_AGENT"), role("MODERATOR"))).toBe(true);
  });

  it("döngü yaratmayan bir kenara döngü demiyor", () => {
    expect(wouldCycle(SEEDED_CLOSURES, role("AUDITOR"), role("FINANCE_OFFICER"))).toBe(false);
    expect(wouldCycle(SEEDED_CLOSURES, role("TRUST_LEAD"), role("COMPANY_APPROVER"))).toBe(false);
  });

  it("parent'ın child'a zaten ulaşıyor olmasına döngü demiyor", () => {
    /**
     * Kuralın **yanlış-pozitif** yönü. `TRUST_LEAD → SUPPORT_AGENT` kenarı
     * döngü değil: TRUST_LEAD ona MODERATOR üzerinden zaten ulaşıyor ve
     * backend doğrudan kenarı kabul ediyor. Burada `true` dönmek kimseye yetki
     * vermezdi ama açık bir kapıyı ekranda kapatırdı — ve bu, sessizce olurdu:
     * operatör seçeneğin neden kapalı olduğunu sorgulamaz.
     */
    expect(wouldCycle(SEEDED_CLOSURES, role("TRUST_LEAD"), role("SUPPORT_AGENT"))).toBe(false);
    expect(wouldCycle(SEEDED_CLOSURES, role("OWNER"), role("SUPPORT_AGENT"))).toBe(false);
    expect(wouldCycle(SEEDED_CLOSURES, role("OWNER"), role("MODERATOR"))).toBe(false);
  });

  it("seed grafiğinde döngü sayılan çiftlerin tamamı bu liste", () => {
    /**
     * Kapının iki yönü de tek iddiada. Bir yön eksik ölçüldüğünde ne olduğu
     * bu PR'da görüldü: `|| closureWithSelf(graph, parent).includes(child)`
     * eklemek gerçek döngüleri koruyup meşru seçenekleri kapatıyor ve 516
     * testin hepsi yeşil kalıyordu. Küme eşitliği her iki yönde de kırılır —
     * fazladan bir çift de eksik bir çift de bu listeyi tutturamaz.
     */
    const cycling: string[] = [];
    for (const parent of SEEDED) {
      for (const child of SEEDED) {
        if (parent.code === child.code) continue;
        if (wouldCycle(SEEDED_CLOSURES, parent.code, child.code)) {
          cycling.push(`${parent.code}→${child.code}`);
        }
      }
    }

    expect(cycling.sort()).toEqual(
      [
        // Çocuk ebeveyne zaten ulaşıyor: kenar yazılsa grafik kendini içerirdi.
        "SUPPORT_AGENT→MODERATOR",
        "SUPPORT_AGENT→DISPUTE_HANDLER",
        "SUPPORT_AGENT→COMPANY_APPROVER",
        "SUPPORT_AGENT→TRUST_LEAD",
        "MODERATOR→TRUST_LEAD",
        "DISPUTE_HANDLER→TRUST_LEAD",
        "FINANCE_ANALYST→FINANCE_OFFICER",
        // OWNER her şeye ulaşıyor, yani hiçbir rol OWNER'ı kapsayamaz.
        "CATALOG_EDITOR→OWNER",
        "SUPPORT_AGENT→OWNER",
        "FINANCE_ANALYST→OWNER",
        "AUDITOR→OWNER",
        "MODERATOR→OWNER",
        "DISPUTE_HANDLER→OWNER",
        "COMPANY_APPROVER→OWNER",
        "TRUST_LEAD→OWNER",
        "FINANCE_OFFICER→OWNER",
      ].sort(),
    );
  });

  it("kapanışı bilinmeyen bir rolü kapsamayı döngü saymıyor", () => {
    // Grafikte olmayan bir rol yalnız kendine ulaşır; onu kapsamak döngü
    // yaratmaz. Fail-closed olması gereken yer burası değil: karar backend'in.
    expect(wouldCycle(SEEDED_CLOSURES, role("OWNER"), role("YENİ_ROL"))).toBe(false);
  });
});

describe("görev ayrılığı ön izlemesi", () => {
  it("seed'lenmiş grafikte OWNER dışında hiçbir rol iki dalı kapsamıyor", () => {
    // ADR-0014 §Rol grafiği'nin kuralı, seed üzerinde doğrulanmış hâli.
    // koala-backend'de bunun karşılığı hem seed testi hem de yazım sırasında
    // çalışan `StaffSeparationOfDuties`: panel yalnız sonucu önceden gösterir.
    const offenders = SEEDED.filter((entry) => separationVerdictOf(SEEDED, entry.code).violates);

    expect(offenders.map((entry) => entry.code)).toEqual([]);
  });

  it("OWNER'ı ihlal saymıyor ama iki dalı kapsadığını da saklamıyor", () => {
    const verdict = separationVerdictOf(SEEDED, role("OWNER"));

    expect(verdict.branches).toEqual(["TRUST", "FINANCE"]);
    expect(verdict.exempt).toBe(true);
    expect(verdict.violates).toBe(false);
    expect(separationSentence(role("OWNER"), verdict)).toContain("yalnız OWNER için serbest");
  });

  it("TRUST_LEAD'i güven dalında, FINANCE_OFFICER'ı finans dalında görüyor", () => {
    expect(separationVerdictOf(SEEDED, role("TRUST_LEAD")).branches).toEqual(["TRUST"]);
    expect(separationVerdictOf(SEEDED, role("FINANCE_OFFICER")).branches).toEqual(["FINANCE"]);
  });

  it("hiçbir dala değmeyen rolleri dal dışı bırakıyor", () => {
    expect(separationVerdictOf(SEEDED, role("CATALOG_EDITOR")).branches).toEqual([]);
    expect(separationVerdictOf(SEEDED, role("AUDITOR")).branches).toEqual([]);
  });

  it("iki dalı birleştiren bir rolü ihlal olarak işaretliyor", () => {
    const merged: RoleGraphNode[] = [...SEEDED, node("HER_ŞEYCİ", "TRUST_LEAD", "FINANCE_OFFICER")];

    const verdict = separationVerdictOf(merged, role("HER_ŞEYCİ"));

    expect(verdict.branches).toEqual(["TRUST", "FINANCE"]);
    expect(verdict.exempt).toBe(false);
    expect(verdict.violates).toBe(true);
    expect(separationSentence(role("HER_ŞEYCİ"), verdict)).toContain("OWNER dışında yasaklar");
  });

  it("bir kapsamanın kuralı bozacağını yazılmadan önce söylüyor", () => {
    // Ekrandaki uyarının kaynağı. Hiçbir şey yazılmıyor: `SEEDED` değişmiyor.
    const before = separationVerdictOf(SEEDED, role("TRUST_LEAD"));
    const after = separationVerdictAfterInclude(
      SEEDED,
      role("TRUST_LEAD"),
      role("FINANCE_OFFICER"),
    );

    expect(before.violates).toBe(false);
    expect(after.violates).toBe(true);
    expect(separationVerdictOf(SEEDED, role("TRUST_LEAD")).violates).toBe(false);
  });

  it("OWNER için aynı kapsamayı ihlal saymıyor", () => {
    expect(
      separationVerdictAfterInclude(SEEDED, role("OWNER"), role("FINANCE_OFFICER")).violates,
    ).toBe(false);
  });

  it("rolü iki dala taşımayan kenarı, etkilenen personeli iki dala taşıyorsa reddedilecek sayıyor", () => {
    /**
     * CATALOG_EDITOR tek başına dal dışı, MODERATOR yalnız güven dalında.
     * Fakat CATALOG_EDITOR + FINANCE_OFFICER taşıyan kişi, yeni kenarla güven
     * ve finans dallarını birleştirir. Backend etkilenen personel
     * üyeliklerini de denetlediği için panelin ön izlemesi de bunu görmeli.
     */
    const memberships = [[role("FINANCE_OFFICER"), role("CATALOG_EDITOR")]];

    expect(
      wouldViolateSeparationAfterInclude(
        SEEDED,
        role("CATALOG_EDITOR"),
        role("MODERATOR"),
        memberships,
      ),
    ).toBe(true);
  });

  it("tek dala değen bir rolde söylenecek bir şey olmadığını söylüyor", () => {
    expect(
      separationSentence(role("TRUST_LEAD"), separationVerdictOf(SEEDED, role("TRUST_LEAD"))),
    ).toBeNull();
  });
});

describe("görev ayrılığı, üyelik tarafında", () => {
  /**
   * Aynı kural, insanın eliyle en kolay kurulan hâli: kimsenin rol grafiğine
   * dokunması gerekmiyor, bir kişiye iki rol vermek yetiyor. Backend bunu
   * yazım sırasında reddeder; buradaki hesap aynı sonucun arayüz ön izlemesi,
   * nihai kapı değildir.
   */
  it("iki dalın rollerini yan yana taşıyan kişiyi ihlal olarak işaretliyor", () => {
    const verdict = membershipSeparationVerdict(
      membershipClosure(SEEDED_CLOSURES, [role("TRUST_LEAD"), role("FINANCE_OFFICER")]),
    );

    expect(verdict.branches).toEqual(["TRUST", "FINANCE"]);
    expect(verdict.exempt).toBe(false);
    expect(verdict.violates).toBe(true);
    expect(membershipSeparationSentence("Ayşe", verdict)).toContain("OWNER dışında yasaklar");
  });

  it("tek dala değen bir kişide söylenecek bir şey olmadığını söylüyor", () => {
    const verdict = membershipSeparationVerdict(
      membershipClosure(SEEDED_CLOSURES, [role("TRUST_LEAD")]),
    );

    expect(verdict.branches).toEqual(["TRUST"]);
    expect(verdict.violates).toBe(false);
    expect(membershipSeparationSentence("Ayşe", verdict)).toBeNull();
  });

  it("OWNER taşıyan kişiyi ihlal saymıyor ama iki dala ulaştığını saklamıyor", () => {
    // İstisna kişinin kapanışından okunuyor: "bu kişi OWNER'a ulaşıyor mu",
    // "bu rol OWNER mı" değil.
    const verdict = membershipSeparationVerdict(
      membershipClosure(SEEDED_CLOSURES, [role("OWNER")]),
    );

    expect(verdict.branches).toEqual(["TRUST", "FINANCE"]);
    expect(verdict.exempt).toBe(true);
    expect(verdict.violates).toBe(false);
    expect(membershipSeparationSentence("Ayşe", verdict)).toContain("OWNER üzerinden");
  });

  it("rolsüz bir kişiyi hiçbir dala koymuyor", () => {
    const verdict = membershipSeparationVerdict(membershipClosure(SEEDED_CLOSURES, []));

    expect(verdict.branches).toEqual([]);
    expect(verdict.violates).toBe(false);
  });

  it("kalıtımla gelen dalı da sayıyor", () => {
    // MODERATOR güven dalında; FINANCE_OFFICER finans dalına FINANCE_ANALYST
    // üzerinden iniyor. İkisini taşıyan kişi iki daldadır.
    const verdict = membershipSeparationVerdict(
      membershipClosure(SEEDED_CLOSURES, [role("MODERATOR"), role("FINANCE_OFFICER")]),
    );

    expect(verdict.violates).toBe(true);
  });

  it("bir atamanın kuralı bozacağını yazılmadan önce söylüyor", () => {
    const before = membershipSeparationVerdict(
      membershipClosure(SEEDED_CLOSURES, [role("TRUST_LEAD")]),
    );
    const after = membershipSeparationVerdictAfterGrant(
      SEEDED_CLOSURES,
      [role("TRUST_LEAD")],
      role("FINANCE_OFFICER"),
    );

    expect(before.violates).toBe(false);
    expect(after.violates).toBe(true);
  });

  it("grafik hiç okunamadığında doğrudan rollerden teşhis koyuyor", () => {
    /**
     * `GET /admin/roles` `role.manage` istiyor ve `staff.manage` taşıyıp onu
     * taşımayan biri için 403 dönüyor. O durumda kapanış haritası boş kalıyor
     * ve teşhis kalıtımı göremiyor — ama kişinin **doğrudan** taşıdığı iki
     * dalı görmeye devam ediyor. Sessizce kaybolmamasının sebebi bu.
     */
    const withoutGraph = closuresWithSelf([]);
    const verdict = membershipSeparationVerdict(
      membershipClosure(withoutGraph, [role("TRUST_LEAD"), role("FINANCE_OFFICER")]),
    );

    expect(verdict.violates).toBe(true);

    // Ve göremediği şey: yalnız kalıtımla gelen dal. FINANCE_OFFICER'ın
    // finans dalı kendi adında olduğu için görünüyor, MODERATOR'ın güven dalı
    // da öyle; kaybolan, yalnız kapsama üzerinden gelenler.
    const inheritedOnly = membershipSeparationVerdict(
      membershipClosure(withoutGraph, [role("OWNER")]),
    );

    expect(inheritedOnly.branches).toEqual([]);
  });
});

describe("dal listeleri kuralın zayıf tarafı, ve öyle yazılı", () => {
  it("koala-backend'in StaffRoleGraphSeedTest'indeki kümelerle birebir aynı", () => {
    // İki depoda iki kopya var ve ikisi de rol adlarını sabit yazıyor. Seed'e
    // yeni bir rol eklendiği gün ikisi de elle güncellenmek zorunda; bu test o
    // kopyanın bugünkü hâlini sabitliyor, eşitliği kendiliğinden sağlamıyor.
    expect([...TRUST_BRANCH_ROLES]).toEqual(["MODERATOR", "DISPUTE_HANDLER", "TRUST_LEAD"]);
    expect([...FINANCE_BRANCH_ROLES]).toEqual(["FINANCE_ANALYST", "FINANCE_OFFICER"]);
    expect([...SEPARATION_EXEMPT_ROLES]).toEqual(["OWNER"]);
  });

  it("listede olmayan bir rolü hiçbir dala koymuyor", () => {
    // Kuralın göremediği şey: seed'den sonra eklenen bir rol. Teşhis sessizce
    // eksik kalır ve bunu bilerek kabul ediyoruz — alternatifi, rol adından
    // dal tahmin etmek olurdu.
    const withNewRole: RoleGraphNode[] = [...SEEDED, node("FINANS_MUDURU", "MODERATOR")];

    const verdict = separationVerdict(
      role("FINANS_MUDURU"),
      closureWithSelf(withNewRole, role("FINANS_MUDURU")),
    );

    // Adı "FINANS" ile başlıyor ama listede olmadığı için finans dalında
    // sayılmıyor; yalnız kapsadığı MODERATOR üzerinden güven dalında.
    expect(verdict.branches).toEqual(["TRUST"]);
  });
});
