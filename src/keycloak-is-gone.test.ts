import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

/**
 * is-koala/koala-admin#15'in kabul maddesi, denetlenebilir hâlde:
 * *"Depoda `keycloak` geçen tek satır kalmadı."*
 *
 * Madde birebir karşılanmıyor ve karşılanmamalı — aşağıdaki iki dosya adı
 * **yokluğu korumak** için taşıyor. Ama o iki dosya `src/` altında, ve `src/`
 * altını denetleyen şey `pnpm typecheck` ile derleyici. Geri kalan hiçbir yerde
 * öyle bir denetim yok: `docs/`, `.github/workflows/`, `.env.example`,
 * `docker/` ya da `pnpm-lock.yaml` adı geri getirse hiçbir test kırılmazdı.
 *
 * ADR-0014'ün asıl kazancı bir dosyanın silinmesi değil, **bağımlılığın
 * kalkması**: panel artık ayrı bir kimlik servisine bağlı değil, yalnız
 * Koala'ya. O bağımlılığın geri gelişi tam olarak böyle görünür — bir compose
 * dosyası, bir CI adımı, bir kurulum belgesi — ve hiçbiri `src/` altında olmak
 * zorunda değil. Bu yüzden tarama depo geneli.
 *
 * ## Bu testin göremedikleri
 *
 *  - **Takip edilmeyen dosyaları.** Kaynak `git ls-files`: depoda olan =
 *    izlenen. `.gitignore`'daki bir dosya, çalışma dizinindeki bir taslak ya da
 *    bir derleme çıktısı bu taramaya girmez. Bu bilinçli — biri de depoya
 *    girmiyor — ama "makinemde bir keycloak compose'u var" bu testin cevabını
 *    değiştirmez.
 *  - **Adı anmayan bir dönüşü.** `KEYCLOAK_*` değişkeni olmadan kurulan bir OIDC
 *    istemcisi, bir `issuer` URL'i ya da `oidc` diye adlandırılmış bir servis
 *    buradan geçer. Aranan bir kelime, bir mimari değil. Yokluğun asıl nöbetçisi
 *    `src/env.test.ts`: panel bir kimlik sağlayıcısı olmadan **açılıyor**, ve
 *    bir değişkenin geri gelmesi orada kırmızıya döner.
 *  - **Bir muafiyetin haksız eklendiğini.** Liste büyüterek de yeşile
 *    dönülebilir. Buna karşı tek şey, listenin bir test dosyasındaki diff olması
 *    — `routes.test.ts`'in `EXPECTED_UNGATED`'i ve `server-actions.test.ts`'in
 *    muafiyetleri ile aynı savunma.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

const NEEDLE = /keycloak/i;

/**
 * Adı taşımaya devam eden dosyalar, her biri gerekçesiyle.
 *
 * Üçü de nöbetçi: adı **kullanmıyor**, geri gelmediğini doğruluyor. Silmek
 * kabul maddesini birebir karşılardı ve tam olarak onu denetimsiz bırakırdı.
 */
const SENTINELS: Record<string, string> = {
  "src/env.test.ts":
    "`Object.keys(env)` üzerinde `/KEYCLOAK|AUTH_SECRET|AUDIENCE/` regex'i: bir " +
    "değişkenin geri gelmesi, onunla birlikte bağımlılığın da geri gelmesi " +
    "demektir. ADR-0014'ün ölçülebilir hâli bu satır.",
  "src/server/auth/errors.test.ts":
    '`isAuthFailureCode("KEYCLOAK_UNREACHABLE")` — panelin hata kelime ' +
    "dağarcığının bir kimlik sağlayıcısının üretebileceği kodları tanımadığını " +
    "doğruluyor. Kod listesi kullanıcıya gösterilen cümleleri seçtiği için, " +
    "geri gelen bir kodun karşılığı geri gelen bir ekrandır.",
  "src/keycloak-is-gone.test.ts":
    "Bu dosyanın kendisi. Aradığı kelimeyi yazmak zorunda; muafiyeti de bu " +
    "yüzden burada, listenin ilk satırı olarak değil son satırı olarak duruyor.",
};

const run = promisify(execFile);

/**
 * Depodaki her dosya — yani `git`'in izlediği her dosya.
 *
 * `node_modules`, `.next` ve derleme çıktıları böylece kendiliğinden dışarıda
 * kalıyor; el yazısı bir dışlama listesi tutmaktan iyi, çünkü o liste eksik
 * kaldığında test yavaşlar ya da yanlış yerde kırmızıya döner.
 */
async function trackedFiles(): Promise<string[]> {
  const { stdout } = await run("git", ["ls-files", "-z"], {
    cwd: REPO_ROOT,
    maxBuffer: 32 * 1024 * 1024,
  });

  return stdout.split("\0").filter((file) => file.length > 0);
}

describe("the repository has no Keycloak left in it", () => {
  it("names it nowhere but in the guards that keep it away", async () => {
    const files = await trackedFiles();

    // Tarama gerçekten bir depo gördü mü: boş bir liste her iddiayı doğru
    // çıkarırdı.
    expect(files.length).toBeGreaterThan(50);
    expect(files).toContain("package.json");
    expect(files).toContain(".github/workflows/ci.yml");

    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(path.join(REPO_ROOT, file), "utf8").catch(() => "");
      if (NEEDLE.test(contents) && !(file in SENTINELS)) {
        offenders.push(file);
      }
    }

    expect(
      offenders,
      "ADR-0014 Keycloak'ı projeden çıkardı. Bu dosya(lar) adı geri getiriyor; " +
        "kaldırın ya da bir nöbetçiyse src/keycloak-is-gone.test.ts'e gerekçesiyle yazın.",
    ).toEqual([]);
  });

  it("lets no exemption outlive the thing it was written for", async () => {
    // Adını taşımayı bırakmış bir nöbetçi, artık nöbet tutmuyordur. Listede
    // kalması, denetlendiğini sanmaya devam etmek olurdu.
    const files = new Set(await trackedFiles());

    for (const [file, reason] of Object.entries(SENTINELS)) {
      expect(files.has(file), `${file} artık depoda yok`).toBe(true);

      const contents = await readFile(path.join(REPO_ROOT, file), "utf8");
      expect(NEEDLE.test(contents), `${file} adı artık anmıyor`).toBe(true);

      // Tip zaten bir metin istiyor; bu, boş bir metni yakalar.
      expect(reason.length, file).toBeGreaterThan(40);
    }
  });
});
