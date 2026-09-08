import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * `routes.test.ts`'in eylem tarafındaki eşi.
 *
 * Kapının iki yarısı var ve yalnız biri yapısal olarak sabitlenmişti. Sayfa
 * yarısı: dosya sistemi neyin var olduğunu, `routes.ts` neyin gerektiğini
 * söylüyor, ve `routes.test.ts` ikisinin ayrışmasına izin vermiyor. Eylem
 * yarısında böyle bir şey yoktu — bugün her `"use server"` dosyası izni
 * gerçekten yeniden çözüyor, ama **kapıyı atlayan yeni bir eylem hiçbir testi
 * kırmazdı.**
 *
 * Neden bu ayrı bir kapı: bir Server Action, kendi URL'i olan bir POST ucudur.
 * Formu çizen sayfanın `<RequirePermission>`'ı onun için hiç çalışmaz —
 * `decisions.ts`'in deyişiyle, gizli bir `<div>`'in veriyi koruduğu kadar korur.
 *
 * ## Bu testin göremedikleri
 *
 * Metin okuyor, davranış ölçmüyor. Sırayla:
 *
 *  - **Cevabın kullanıldığını göremez.** `await guardDecision(...)` yazıp dönen
 *    değeri atan bir eylem buradan geçer. Onu ölçen yer ayrı ve istek sayısıyla
 *    ölçüyor: `decisions.test.ts`, `operations.test.ts`, `gate.test.tsx`.
 *  - **Doğru izni istediğini göremez.** Sayfa tarafında `routes.ts` her rotanın
 *    iznini adıyla yazıyor ve `routes.test.ts` sayfayı ona karşı denetliyor;
 *    eylemler için böyle bir kayıt defteri yok, üstelik para kapısı izni çağrı
 *    yerinden değil işlem türünden seçiyor (`PERMISSION_FOR`). Yani buradaki
 *    iddia "bir kapıdan geçiyor", "doğru kapıdan geçiyor" değil.
 *  - **Son `export`'un sınırını göremez.** Dosya `^export ` ile bölünüyor, yani
 *    son eylemin metni dosya sonuna kadar uzanıyor ve altındaki yardımcı
 *    fonksiyonları da içeriyor. Oradaki bir kapı çağrısı, o eylemi kapılı
 *    gösterir.
 *  - **Farklı yazılmış bir direktifi göremez.** Yalnız tek başına duran
 *    `"use server";` satırı sayılıyor. Bir kütüphane yardımcısının ürettiği ya
 *    da derleme adımında eklenen bir eylem bu taramaya hiç görünmez.
 *  - **Route Handler'ları görmez.** `route.ts` de bir HTTP ucudur; onların
 *    kayıt defterindeki karşılığı `routes.test.ts`'te, gating'i değil.
 */

const SRC_DIR = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Bir eylemin izni yeniden çözmek için geçebileceği kapılar.
 *
 * Üçü de aynı şeyi yapıyor — `getStaffContext()`'i çağırıp cevaba göre
 * reddediyor — ama farklı biçimde cevap veriyorlar: `guardDecision` bir kuyruk
 * kararı için hazır `DecisionState`, `runEscrowOperation` para hareketinin
 * tamamı, `runAuthorizationChange` rol grafiğine ve personel kayıtlarına yapılan
 * her yazım. Liste burada duruyor ki dördüncü bir kapı eklemek bir diff olsun.
 */
const ACTION_GATES: Record<string, string> = {
  "guardDecision(": "src/server/queue/decisions.ts",
  "runEscrowOperation(": "src/server/escrow/operations.ts",
  "runAuthorizationChange(": "src/server/authz/administration.ts",
};

/**
 * İzin kapısından geçmeyen `"use server"` dosyaları, her biri gerekçesiyle.
 *
 * `routes.test.ts`'teki `EXPECTED_UNGATED` ile aynı düzen ve aynı sebeple: bu
 * listeyi büyütmek bir test dosyasındaki diff olsun, uzun bir dizideki bir
 * satır daha değil.
 */
const EXPECTED_UNGATED_ACTIONS: Record<string, string> = {
  "src/server/auth/actions.ts":
    "Kimlik eylemlerinin kendisi: gir, çık, parolanı değiştir. Üçü de izin " +
    "çözülemediği hâlde çalışmak zorunda — girişin öncesinde henüz bir kimlik " +
    "yok, ve parola değiştirme tam olarak backend'in her `/admin/**` ucunu " +
    "reddettiği durumda çalışan tek uç. Bir izin kapısı, bayrağı düşürmenin tek " +
    "yolunu kalıcı olarak kilitlerdi — `routes.test.ts`'in `/giris/parola` için " +
    "yazdığı gerekçenin eylem tarafındaki aynısı.",
};

/** Tek başına duran bir `"use server";` satırı — düzyazıdaki anışları değil. */
const USE_SERVER = /^\s*"use server";\s*$/m;

async function sourceFiles(dir: string = SRC_DIR): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await sourceFiles(full)));
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.[cm]?[jt]sx?$/.test(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

interface ActionUnit {
  /** `src/`'ten göreli yol — hata mesajında ve muafiyet listesinde kullanılan ad. */
  readonly file: string;
  readonly source: string;
}

async function actionUnits(): Promise<ActionUnit[]> {
  const units: ActionUnit[] = [];

  for (const full of await sourceFiles()) {
    const source = await readFile(full, "utf8");
    if (!USE_SERVER.test(source)) continue;

    units.push({
      file: `src/${path.relative(SRC_DIR, full).split(path.sep).join("/")}`,
      source,
    });
  }

  return units;
}

/**
 * Dosyayı `export` bildirimlerine bölüp async fonksiyon olanları döndürür.
 *
 * Bu depoda `export` yalnız sütun 0'da ve yalnız bir bildirimin başında geçiyor,
 * bu yüzden bölme yeterli. Sınırı olan tek yer son export — bkz. dosya başındaki
 * "göremedikleri".
 */
function exportedActions(source: string): { name: string; body: string }[] {
  const actions: { name: string; body: string }[] = [];

  for (const chunk of source.split(/^export /m).slice(1)) {
    const name = /^async function (\w+)/.exec(chunk)?.[1];
    if (name !== undefined) actions.push({ name, body: chunk });
  }

  return actions;
}

function gateIn(body: string): string | null {
  return Object.keys(ACTION_GATES).find((call) => body.includes(call)) ?? null;
}

describe("the scan sees the Server Actions this slice ships", () => {
  it("finds every module that declares one, and not the prose that mentions one", async () => {
    const units = await actionUnits();
    const files = units.map((unit) => unit.file);

    // Boş bir tarama sessizce geçemesin: bugün dört tane var.
    expect(files.length).toBeGreaterThanOrEqual(4);
    expect(files).toContain("src/server/escrow/actions.ts");
    expect(files).toContain("src/app/(panel)/companies/actions.ts");

    // `"use server"`'ı yalnız anlatan dosyalar bir eylem taşımıyor; taramaya
    // girmeleri her birini gereksiz bir muafiyet satırına çevirirdi.
    expect(files).not.toContain("src/lib/escrow-form.ts");
    expect(files).not.toContain("src/server/api/reports.ts");
  });

  it("reads an action out of every one of them", async () => {
    // `exportedActions` metin bölüyor; bir gün hiçbir şey bulamayacak hâle
    // gelirse aşağıdaki iddiaların hepsi boş kümede doğru çıkardı.
    for (const unit of await actionUnits()) {
      expect(exportedActions(unit.source).length, unit.file).toBeGreaterThan(0);
    }
  });
});

describe("every Server Action re-resolves the permission, or says why not", () => {
  it("routes each exported action through a gate", async () => {
    const ungated: string[] = [];

    for (const unit of await actionUnits()) {
      if (unit.file in EXPECTED_UNGATED_ACTIONS) continue;

      for (const action of exportedActions(unit.source)) {
        if (gateIn(action.body) === null) {
          ungated.push(`${unit.file} → ${action.name}`);
        }
      }
    }

    expect(
      ungated,
      `Bir Server Action izni yeniden çözmüyor. Bir kapıdan geçirin (${Object.keys(
        ACTION_GATES,
      ).join(", ")}) ya da gerekçesini src/server/authz/server-actions.test.ts'e yazın.`,
    ).toEqual([]);
  });

  it("leaves exactly the ungated modules that were argued for, and no others", async () => {
    const units = await actionUnits();
    const exempt = units
      .map((unit) => unit.file)
      .filter((file) => file in EXPECTED_UNGATED_ACTIONS);

    expect(exempt).toEqual(Object.keys(EXPECTED_UNGATED_ACTIONS));
  });

  it("makes every exemption explain itself in writing", () => {
    for (const [file, reason] of Object.entries(EXPECTED_UNGATED_ACTIONS)) {
      // Tip zaten bir metin istiyor; bu, boş bir metni yakalar.
      expect(reason.length, file).toBeGreaterThan(40);
    }
  });
});

describe("a gate is a gate because it asks the backend", () => {
  it("resolves permissions inside every entry point this test trusts", async () => {
    /**
     * Yukarıdaki iddianın anlamı bütünüyle buna bağlı. `guardDecision` bir gün
     * izni çözmeyi bırakırsa, "bir kapıdan geçiyor" doğru kalır ve hiçbir şey
     * ifade etmez — kapı adını taşıyan bir fonksiyon çağrısına dönüşürdü.
     *
     * `getStaffContext()` fail-closed olan yer: her başarısızlık boş bir izin
     * listesi üretiyor, yani ulaşılamayan bir backend kararı reddediyor,
     * geçirmiyor.
     */
    for (const [call, file] of Object.entries(ACTION_GATES)) {
      const source = await readFile(path.join(SRC_DIR, "..", file), "utf8");

      expect(source, `${file} (${call})`).toContain("getStaffContext(");
    }
  });
});
