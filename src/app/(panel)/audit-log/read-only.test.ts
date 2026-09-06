import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

/**
 * Two rules about this screen that no single render can prove, expressed the
 * way this repo expresses an absence — as a grep, like
 * `src/server/api/forbidden-headers.test.ts` and
 * `src/server/auth/no-client-secrets.test.ts`.
 *
 * **No polling.** `audit-log-page.test.tsx` watches one render and sees one
 * request, and `audit-log-table.test.tsx` runs the clock forward ten minutes
 * and sees nothing scheduled. Neither would catch a timer added next quarter by
 * someone who never read the reason, and the reason is not obvious: reading the
 * audit log is itself an audited, sensitive read (koala-backend#15), so a
 * fifteen-second refresh would spend the afternoon writing rows into the table
 * it is refreshing. After a week the log would mostly be a log of itself being
 * looked at.
 *
 * **No writes.** koala-admin#10 puts editing and deleting out of scope
 * permanently rather than for this slice: the record's whole value is that it
 * cannot be altered from the place it is read. Retention and KVKK erasure
 * belong to koala-backend#15.
 */

const SRC_DIR = fileURLToPath(new URL("../../../", import.meta.url));

/** Every non-test source file this screen is made of. */
async function auditLogSources(): Promise<[string, string][]> {
  const roots = [
    path.join(SRC_DIR, "app", "(panel)", "audit-log"),
    path.join(SRC_DIR, "components", "panel"),
    path.join(SRC_DIR, "lib"),
    path.join(SRC_DIR, "server", "api"),
  ];

  const files: [string, string][] = [];

  for (const root of roots) {
    for (const entry of await readdir(root, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      if (!/audit|^page\./.test(entry.name)) continue;
      if (/\.test\.[jt]sx?$/.test(entry.name)) continue;

      const full = path.join(root, entry.name);
      files.push([path.relative(SRC_DIR, full), await readFile(full, "utf8")]);
    }
  }

  return files;
}

/**
 * The prose in these files explains the rules by naming the things they forbid.
 * The rules are about code, so the comments come out first — otherwise the test
 * would fail on the paragraph explaining why it exists.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the audit viewer refreshes only when a person asks", () => {
  it("finds the files it is supposed to be checking", async () => {
    const sources = await auditLogSources();
    const names = sources.map(([name]) => name);

    // An empty scan would make every assertion below vacuously true.
    expect(names).toContain(path.join("app", "(panel)", "audit-log", "page.tsx"));
    expect(names).toContain(path.join("components", "panel", "audit-log-table.tsx"));
    expect(names).toContain(path.join("lib", "audit-log.ts"));
    expect(names).toContain(path.join("server", "api", "audit.ts"));
    expect(sources.length).toBeGreaterThanOrEqual(6);
  });

  it("contains no timer, no revalidation window and no client refetch", async () => {
    const offenders: string[] = [];

    for (const [name, contents] of await auditLogSources()) {
      const body = withoutComments(contents);
      if (
        /setInterval|setTimeout|router\.refresh|refetchInterval|revalidate\s*[:=]|useSWR|useQuery/.test(
          body,
        )
      ) {
        offenders.push(name);
      }
    }

    expect(
      offenders,
      "Denetim kaydı kendiliğinden yenilenmemeli: okuma da kaydedilir, periyodik yenileme okunan tabloyu şişirir.",
    ).toEqual([]);
  });
});

describe("the panel only reads the audit log", () => {
  it("makes no mutating call from any of these files", async () => {
    const offenders: string[] = [];

    for (const [name, contents] of await auditLogSources()) {
      const body = withoutComments(contents);
      if (
        /method:\s*["'](POST|PUT|PATCH|DELETE)["']|koalaApi\.(post|put|patch|delete)\b/.test(body)
      ) {
        offenders.push(name);
      }
    }

    expect(
      offenders,
      "Denetim kaydında düzenleme ya da silme yok; kaydın değeri değiştirilemezliğinden geliyor (koala-admin#10).",
    ).toEqual([]);
  });

  it("renders no form that could submit a change", async () => {
    // The two forms on this screen are `method="get"`, which is a navigation
    // rather than a write. A `method="post"` form here would be a Server Action
    // in disguise.
    const offenders: string[] = [];

    for (const [name, contents] of await auditLogSources()) {
      const body = withoutComments(contents);
      if (/method="post"/i.test(body) || /<form(?![^>]*method=)/.test(body)) {
        offenders.push(name);
      }
    }

    expect(offenders).toEqual([]);
  });
});
