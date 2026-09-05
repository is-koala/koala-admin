import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The issue's rule, as a grep: the client secret lives in a server-side
 * environment variable and reaches no `NEXT_PUBLIC_*` and no client bundle.
 *
 * A unit test cannot express "nowhere". `config.test.ts` proves the session
 * carries no token; this proves nobody adds a `NEXT_PUBLIC_` door for one
 * tomorrow. The distinction matters because `NEXT_PUBLIC_` is not a warning —
 * Next.js inlines those values into the browser bundle silently, and the
 * mistake looks exactly like working code.
 *
 * Same shape as `src/server/api/forbidden-headers.test.ts`, deliberately: this
 * repo has one way of proving an absence.
 */

const SRC_DIR = fileURLToPath(new URL("../../", import.meta.url));

/** Tests are exempt: proving a prefix is absent means writing the prefix. */
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

    if (/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) && !isTestFile(entry.name)) {
      files.push(full);
    }
  }

  return files;
}

describe("secrets never take a public route to the browser", () => {
  it("no NEXT_PUBLIC_ variable exists anywhere under src/", async () => {
    const files = await collectSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      // The prose in src/env.ts explains the rule and has to name the prefix;
      // an actual use is `process.env.NEXT_PUBLIC_…`.
      if (contents.includes("process.env.NEXT_PUBLIC_")) {
        offenders.push(path.relative(SRC_DIR, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  it("no Client Component reaches the auth layer", async () => {
    // `server-only` already breaks the build for this (pnpm verify:server-only
    // demonstrates it), but the failure appears at build time and this one
    // names the file in a test run.
    const files = await collectSourceFiles(SRC_DIR);
    const offenders: string[] = [];

    for (const file of files) {
      const contents = await readFile(file, "utf8");
      const isClientComponent =
        contents.startsWith('"use client"') || contents.startsWith("'use client'");

      if (isClientComponent && /from ["']@\/server\//.test(contents)) {
        offenders.push(path.relative(SRC_DIR, file));
      }
    }

    expect(offenders).toEqual([]);
  });
});
