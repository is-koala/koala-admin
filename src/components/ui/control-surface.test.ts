import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Panel chrome is HeroUI OSS via native HTML + CSS classes. Call sites go
 * through `@/components/ui`; they must not paste BEM strings, raw `<textarea>`
 * / `<select>`, or import `@heroui/react` (that package's Button is a Client
 * Component and would break the JS-free login page).
 */

const SRC_DIR = fileURLToPath(new URL("../../", import.meta.url));

const isTestFile = (name: string) => /\.test\.[cm]?[jt]sx?$/.test(name);

async function collectSourceFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(full)));
      continue;
    }

    if (/\.(ts|tsx)$/.test(entry.name) && !isTestFile(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(SRC_DIR, file);
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("HeroUI control surface", () => {
  it("does not paste BEM button classes outside the Button wrapper", async () => {
    const files = await collectSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(`${path.sep}components${path.sep}ui${path.sep}button.tsx`)) {
        continue;
      }
      const contents = await readFile(file, "utf8");
      if (contents.includes('"button button--') || contents.includes("'button button--")) {
        offenders.push(relative(file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not render a raw textarea or select outside FormField wrappers", async () => {
    const files = await collectSourceFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const file of files) {
      if (file.endsWith(`${path.sep}components${path.sep}ui${path.sep}form-field.tsx`)) {
        continue;
      }
      const contents = withoutComments(await readFile(file, "utf8"));
      if (contents.includes("<textarea") || /<select[\s>]/.test(contents)) {
        offenders.push(relative(file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("does not import @heroui/react into the app source", async () => {
    const files = await collectSourceFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      if (/from ["']@heroui\/react["']/.test(contents)) {
        offenders.push(relative(file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
