import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { PERMISSIONS } from "../authz/permissions";

import { decodeStaffSession, encodeStaffSession, type StaffSession } from "./cookies";

/**
 * ADR-0010'un kuralı, sabitlenmiş: **izinler token'da da oturumda da durmaz.**
 *
 * ADR-0014 kimlik yarısını geri aldı ama bu yarıya dokunmadı, ve tam olarak bu
 * yüzden burası artık daha kırılgan: eskiden izinleri çereze koymak Auth.js'in
 * `session` callback'ini de değiştirmeyi gerektirirdi; bugün çerezi biz
 * yazıyoruz, yani `permissions` alanını eklemek bir satırlık iş.
 *
 * Korunan şey bir sızıntı değil bir kestirme: menü çizilirken backend'e
 * sormamak için izin listesini çereze koymak. Çalışır, hızlıdır ve ADR'nin
 * token'dan çıkardığı bayatlığı geri getirir — geri alınmış bir
 * `payout.release`, çerez yenilenene kadar harcanabilir kalırdı.
 *
 * Üç yarım, çünkü hiçbiri tek başına yetmiyor: çerezin bugün ne taşıdığı, auth
 * katmanının bir izni öğrenme yolunun olup olmadığı, ve o katmanda bir izin
 * adının kod olarak geçip geçmediği.
 */

const SESSION: StaffSession = {
  accessToken: "access.token.value",
  refreshToken: "refresh.token.value",
  accessExpiresAt: Date.now() + 900_000,
  refreshExpiresAt: Date.now() + 43_200_000,
  mustChangePassword: false,
};

describe("no permission reaches the session cookie", () => {
  it("puts no permission name in the cookie's decoded payload", () => {
    // Çerezin kendisi bu nesnedir. Şifreli olmadığı için üzerinde doğrudan
    // iddia kurulabiliyor — Auth.js döneminde ciphertext'e bakmak gerekiyordu.
    const decoded = decodeStaffSession(encodeStaffSession(SESSION));
    const serialised = JSON.stringify(decoded);

    for (const permission of PERMISSIONS) {
      expect(serialised, `çerezde ${permission}`).not.toContain(permission);
    }

    expect(Object.keys(decoded ?? {})).not.toContain("permissions");
    expect(Object.keys(decoded ?? {})).not.toContain("izinler");
    expect(Object.keys(decoded ?? {})).not.toContain("roles");
  });

  it("drops a permission list smuggled into the object before it is written", () => {
    // Biri sonraki bir dilimde `permissions` alanını ekler. Çözücü bir beyaz
    // liste olduğu için alan geri gelmez; bu testin işi o beyaz listeyi beyaz
    // liste olarak tutmak.
    const smuggled = {
      ...SESSION,
      permissions: ["payout.release", "category.manage"],
      roles: ["OWNER"],
    };

    const decoded = decodeStaffSession(encodeStaffSession(smuggled as StaffSession));

    expect(JSON.stringify(decoded)).not.toContain("payout.release");
    expect(Object.keys(decoded ?? {})).not.toContain("permissions");
    expect(Object.keys(decoded ?? {})).not.toContain("roles");
  });
});

const AUTH_DIR = fileURLToPath(new URL(".", import.meta.url));

async function sourceFiles(dir: string): Promise<string[]> {
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

describe("the auth layer has no way to learn a permission", () => {
  it("imports nothing from the authz layer", async () => {
    // Yapısal yarım. Bu katman "bu kişi kim" sorusunu cevaplıyor; "ne
    // yapabilir" sorusu `src/server/authz`'ın ve backend'in. Buradaki bir
    // import, ikinci sorunun birincisinden türetilmesine atılan ilk adım olurdu.
    const files = await sourceFiles(AUTH_DIR);
    expect(files.length).toBeGreaterThan(3);

    const offenders: string[] = [];
    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (/from ["'](@\/server\/authz|\.\.\/authz)/.test(contents)) {
        offenders.push(path.relative(AUTH_DIR, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("uses no permission name as a value anywhere in src/server/auth", async () => {
    // Yalnız tırnaklı geçişler — `src/server/api/forbidden-headers.test.ts` ile
    // aynı düzen. Düzyazı bir izni adıyla anabilir (`cookies.ts` çerezin neden
    // korunmaya değer olduğunu payout.release'e işaret ederek anlatıyor ve o
    // açıklama yerini hak ediyor); `"…"` ya da `'…'` ise koddur, ve buradaki bir
    // kod, auth katmanının izinler üzerine akıl yürütmeye başladığı anlamına
    // gelir. Bu depoda yorumlardaki backtick markdown'dır, literal sayılmaz.
    const files = await sourceFiles(AUTH_DIR);
    expect(files.length).toBeGreaterThan(3);

    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      for (const permission of PERMISSIONS) {
        const quoted = [`"${permission}"`, `'${permission}'`];
        if (quoted.some((needle) => contents.includes(needle))) {
          offenders.push(`${path.relative(AUTH_DIR, file)} → ${permission}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
