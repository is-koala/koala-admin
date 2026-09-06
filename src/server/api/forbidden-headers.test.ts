import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * The issue asks for something a unit test cannot express on its own: not one
 * line of code sends `X-Device-Id` or `X-App-Version`.
 *
 * `koala.test.ts` proves the client does not send them today. This proves
 * nothing anywhere in `src/` reintroduces them tomorrow — a grep, run as a
 * test, so CI is the thing that notices.
 *
 * Why they must stay out: those headers belong to the mobile/web client
 * contract. `core/configs/MinimumAppVersionFilter.java` lets a request through
 * when they are absent, and `/admin/**` is moving to its own filter chain
 * (koala-backend#14), so sending them would buy nothing and would quietly
 * enrol the panel in a version gate meant for a different client.
 */

const FORBIDDEN = ["x-device-id", "x-app-version"];

const SRC_DIR = fileURLToPath(new URL("../..", import.meta.url));

/**
 * Tests are exempt: asserting that a header is absent means naming it.
 * Everything that ships is in scope.
 */
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

describe("device headers", () => {
  it("appear nowhere under src/", async () => {
    const files = await collectSourceFiles(SRC_DIR);
    expect(files.length).toBeGreaterThan(10);

    const offenders: string[] = [];

    for (const file of files) {
      const contents = (await readFile(file, "utf8")).toLowerCase();
      for (const header of FORBIDDEN) {
        if (contents.includes(`"${header}"`) || contents.includes(`'${header}'`)) {
          offenders.push(`${path.relative(SRC_DIR, file)} → ${header}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });
});
