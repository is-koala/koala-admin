import { describe, expect, it } from "vitest";

import {
  FINANCE_BRANCH_ROLES,
  SEPARATION_EXEMPT_ROLES,
  TRUST_BRANCH_ROLES,
  closureWithSelf,
  separationSentence,
  separationVerdict,
  separationVerdictAfterInclude,
  separationVerdictOf,
  wouldCycle,
  type RoleGraphNode,
} from "./role-graph";

/**
 * Grafiğin okunması — ve okunmasının **karar vermemesi**.
 *
 * Buradaki testler iki farklı şeyi kanıtlıyor ve ikisini karıştırmamak bu
 * dosyanın bütün mesele:
 *
 *  - `wouldCycle`, backend'in 409 ile reddettiği durumun aynadaki görüntüsü.
 *    Yanlış olursa bir düğme gereksiz yere kapanır; kimse yetki kazanmaz.
 *  - `separationVerdict`, backend'in **reddetmediği** bir kuralın teşhisi.
 *    Yanlış olursa bir uyarı yanlış yerde çıkar; yine kimse yetki kazanmaz,
 *    ama ekran yanlış söyler.
 *
 * Hiçbiri bir kapı değil. Kapıyı ölçen dosya `administration.test.ts` ve orada
 * ölçü birimi istek sayısı.
 */

/** ADR-0014 §Rol grafiği'nin seed'i, kenarlarıyla. */
const SEEDED: RoleGraphNode[] = [
  { code: "CATALOG_EDITOR", includes: [] },
  { code: "SUPPORT_AGENT", includes: [] },
  { code: "FINANCE_ANALYST", includes: [] },
  { code: "AUDITOR", includes: [] },
  { code: "MODERATOR", includes: ["SUPPORT_AGENT"] },
  { code: "DISPUTE_HANDLER", includes: ["SUPPORT_AGENT"] },
  { code: "COMPANY_APPROVER", includes: ["SUPPORT_AGENT"] },
  { code: "TRUST_LEAD", includes: ["MODERATOR", "DISPUTE_HANDLER"] },
  { code: "FINANCE_OFFICER", includes: ["FINANCE_ANALYST"] },
  {
    code: "OWNER",
    includes: ["CATALOG_EDITOR", "TRUST_LEAD", "COMPANY_APPROVER", "FINANCE_OFFICER", "AUDITOR"],
  },
];

describe("kapanış, kendisi dâhil", () => {
  it("TRUST_LEAD'in iki dalını birleştirip SUPPORT_AGENT'a iniyor", () => {
    // Bunun neden ağaç değil DAG olduğunun sebebi: SUPPORT_AGENT'a iki ayrı
    // yoldan (MODERATOR ve DISPUTE_HANDLER) ulaşılıyor ve bir kez sayılıyor.
    expect(closureWithSelf(SEEDED, "TRUST_LEAD")).toEqual([
      "DISPUTE_HANDLER",
      "MODERATOR",
      "SUPPORT_AGENT",
      "TRUST_LEAD",
    ]);
  });

  it("yaprak bir rolde yalnız kendisini döndürüyor", () => {
    expect(closureWithSelf(SEEDED, "AUDITOR")).toEqual(["AUDITOR"]);
  });

  it("OWNER'dan on rolün tamamına ulaşıyor", () => {
    expect(closureWithSelf(SEEDED, "OWNER")).toHaveLength(SEEDED.length);
  });

  it("henüz yazılmamış bir kenarı geziye katabiliyor", () => {
    // "Bu kapsamayı eklesem ne olur" sorusunun cevabı; hiçbir şey yazılmıyor.
    const before = closureWithSelf(SEEDED, "AUDITOR");
    const after = closureWithSelf(SEEDED, "AUDITOR", { from: "AUDITOR", to: "FINANCE_OFFICER" });

    expect(before).toEqual(["AUDITOR"]);
    expect(after).toEqual(["AUDITOR", "FINANCE_ANALYST", "FINANCE_OFFICER"]);
  });

  it("bir döngüde sonsuza kadar dönmüyor", () => {
    // Backend böyle bir grafiğe izin vermiyor, ama panel onu bir cevaptan
    // okuyor: bozuk bir veri, ekranı kilitleyen bir döngüye dönüşmemeli.
    const cyclic: RoleGraphNode[] = [
      { code: "A", includes: ["B"] },
      { code: "B", includes: ["A"] },
    ];

    expect(closureWithSelf(cyclic, "A")).toEqual(["A", "B"]);
  });

  it("grafikte olmayan bir rolde yalnız kendisini döndürüyor", () => {
    expect(closureWithSelf(SEEDED, "YOK_BÖYLE_BİR_ROL")).toEqual(["YOK_BÖYLE_BİR_ROL"]);
  });
});

describe("döngü uyarısı, backend'in 409'unun aynası", () => {
  it("bir rolün kendini kapsamasını döngü sayıyor", () => {
    expect(wouldCycle(SEEDED, "TRUST_LEAD", "TRUST_LEAD")).toBe(true);
  });

  it("dolaylı döngüyü de görüyor", () => {
    // SUPPORT_AGENT, TRUST_LEAD'i kapsasaydı: TRUST_LEAD → MODERATOR →
    // SUPPORT_AGENT → TRUST_LEAD. Backend'in `closureOf(child).contains(parent)`
    // koşulu tam olarak bu.
    expect(wouldCycle(SEEDED, "SUPPORT_AGENT", "TRUST_LEAD")).toBe(true);
    expect(wouldCycle(SEEDED, "SUPPORT_AGENT", "MODERATOR")).toBe(true);
  });

  it("döngü yaratmayan bir kenara döngü demiyor", () => {
    expect(wouldCycle(SEEDED, "AUDITOR", "FINANCE_OFFICER")).toBe(false);
    expect(wouldCycle(SEEDED, "TRUST_LEAD", "COMPANY_APPROVER")).toBe(false);
  });
});

describe("görev ayrılığı teşhisi", () => {
  it("seed'lenmiş grafikte OWNER dışında hiçbir rol iki dalı kapsamıyor", () => {
    // ADR-0014 §Rol grafiği'nin kuralı, seed üzerinde doğrulanmış hâli.
    // koala-backend'de bunun karşılığı `StaffRoleGraphSeedTest` — ve orada da,
    // burada da bu bir *seed* denetimi: çalışan bir isteği durduran hiçbir şey
    // ikimizde de yok.
    const offenders = SEEDED.filter((role) => separationVerdictOf(SEEDED, role.code).violates);

    expect(offenders.map((role) => role.code)).toEqual([]);
  });

  it("OWNER'ı ihlal saymıyor ama iki dalı kapsadığını da saklamıyor", () => {
    const verdict = separationVerdictOf(SEEDED, "OWNER");

    expect(verdict.branches).toEqual(["TRUST", "FINANCE"]);
    expect(verdict.exempt).toBe(true);
    expect(verdict.violates).toBe(false);
    expect(separationSentence("OWNER", verdict)).toContain("yalnız OWNER için serbest");
  });

  it("TRUST_LEAD'i güven dalında, FINANCE_OFFICER'ı finans dalında görüyor", () => {
    expect(separationVerdictOf(SEEDED, "TRUST_LEAD").branches).toEqual(["TRUST"]);
    expect(separationVerdictOf(SEEDED, "FINANCE_OFFICER").branches).toEqual(["FINANCE"]);
  });

  it("hiçbir dala değmeyen rolleri dal dışı bırakıyor", () => {
    expect(separationVerdictOf(SEEDED, "CATALOG_EDITOR").branches).toEqual([]);
    expect(separationVerdictOf(SEEDED, "AUDITOR").branches).toEqual([]);
  });

  it("iki dalı birleştiren bir rolü ihlal olarak işaretliyor", () => {
    const merged: RoleGraphNode[] = [
      ...SEEDED,
      { code: "HER_ŞEYCİ", includes: ["TRUST_LEAD", "FINANCE_OFFICER"] },
    ];

    const verdict = separationVerdictOf(merged, "HER_ŞEYCİ");

    expect(verdict.branches).toEqual(["TRUST", "FINANCE"]);
    expect(verdict.exempt).toBe(false);
    expect(verdict.violates).toBe(true);
    expect(separationSentence("HER_ŞEYCİ", verdict)).toContain("OWNER dışında yasaklar");
  });

  it("bir kapsamanın kuralı bozacağını yazılmadan önce söylüyor", () => {
    // Ekrandaki uyarının kaynağı. Hiçbir şey yazılmıyor: `SEEDED` değişmiyor.
    const before = separationVerdictOf(SEEDED, "TRUST_LEAD");
    const after = separationVerdictAfterInclude(SEEDED, "TRUST_LEAD", "FINANCE_OFFICER");

    expect(before.violates).toBe(false);
    expect(after.violates).toBe(true);
    expect(separationVerdictOf(SEEDED, "TRUST_LEAD").violates).toBe(false);
  });

  it("OWNER için aynı kapsamayı ihlal saymıyor", () => {
    expect(separationVerdictAfterInclude(SEEDED, "OWNER", "FINANCE_OFFICER").violates).toBe(false);
  });

  it("tek dala değen bir rolde söylenecek bir şey olmadığını söylüyor", () => {
    expect(separationSentence("TRUST_LEAD", separationVerdictOf(SEEDED, "TRUST_LEAD"))).toBeNull();
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
    const withNewRole: RoleGraphNode[] = [
      ...SEEDED,
      { code: "FINANS_MUDURU", includes: ["MODERATOR"] },
    ];

    const verdict = separationVerdict(
      "FINANS_MUDURU",
      closureWithSelf(withNewRole, "FINANS_MUDURU"),
    );

    // Adı "FINANS" ile başlıyor ama listede olmadığı için finans dalında
    // sayılmıyor; yalnız kapsadığı MODERATOR üzerinden güven dalında.
    expect(verdict.branches).toEqual(["TRUST"]);
  });
});
