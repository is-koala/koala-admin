#!/usr/bin/env node
/**
 * Proves that the `import "server-only"` guard actually stops a Client
 * Component from reaching the Koala API client.
 *
 * The whole architecture rests on one line at the top of
 * `src/server/api/koala.ts`. A line like that is easy to delete by accident and
 * impossible to miss the consequences of, so this script demonstrates the
 * failure rather than asserting it exists:
 *
 *   1. Write a Client Component that imports `@/server/api/koala`, plus a page
 *      that renders it.
 *   2. Run `next build`.
 *   3. Assert the build FAILS, and that it fails for this reason.
 *   4. Delete both files, whatever happened.
 *
 * A passing build here is the failure case: it would mean the panel could ship
 * the access token to the browser.
 *
 * Run with: pnpm verify:server-only
 */

import { spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const guardDir = path.join(projectRoot, "src", "app", "server-only-guard-probe");
const buildDir = path.join(projectRoot, ".next");

const CLIENT_COMPONENT = `"use client";

// Deliberate violation, planted by scripts/verify-server-only-guard.mjs.
// A Client Component must not be able to reach the server API client.
import { buildKoalaUrl } from "@/server/api/koala";

export function GuardProbe() {
  return <p>{buildKoalaUrl("/reference/job-categories")}</p>;
}
`;

const PAGE = `import { GuardProbe } from "./probe";

export default function GuardPage() {
  return <GuardProbe />;
}
`;

/** The phrase Next.js uses when the server-only guard trips. */
const EXPECTED_SIGNALS = [
  "cannot be imported from a Client Component",
  "server-only",
  "Server Component",
];

function plant() {
  mkdirSync(guardDir, { recursive: true });
  writeFileSync(path.join(guardDir, "probe.tsx"), CLIENT_COMPONENT, "utf8");
  writeFileSync(path.join(guardDir, "page.tsx"), PAGE, "utf8");
}

function clean() {
  rmSync(guardDir, { recursive: true, force: true });

  // The failed build leaves `.next/types/validator.ts` referencing the probe
  // page that no longer exists, which makes the next `pnpm typecheck` fail for
  // a reason that has nothing to do with the code. The build output is broken
  // anyway — the build failed on purpose — so drop it.
  rmSync(buildDir, { recursive: true, force: true });
}

function main() {
  console.log("→ Planting a Client Component that imports src/server/api/koala.ts");
  plant();

  let result;
  try {
    console.log("→ Running `next build` (this is expected to FAIL)\n");
    result = spawnSync("node", ["node_modules/next/dist/bin/next", "build"], {
      cwd: projectRoot,
      encoding: "utf8",
      env: {
        ...process.env,
        // The guard must trip regardless of environment wiring, so every
        // variable src/env.ts requires gets a placeholder. Without them the
        // build would fail on a missing variable instead of on the violation,
        // and this script would report a guard that it never actually tested.
        KOALA_API_BASE_URL: process.env.KOALA_API_BASE_URL ?? "http://localhost:8080",
        AUTH_URL: process.env.AUTH_URL ?? "http://localhost:3000",
        AUTH_SECRET: process.env.AUTH_SECRET ?? "guard-probe-secret-guard-probe-secret",
        KEYCLOAK_ISSUER: process.env.KEYCLOAK_ISSUER ?? "http://localhost:8085/realms/koala-staff",
        KEYCLOAK_CLIENT_ID: process.env.KEYCLOAK_CLIENT_ID ?? "koala-admin-web",
        KEYCLOAK_CLIENT_SECRET: process.env.KEYCLOAK_CLIENT_SECRET ?? "guard-probe-secret",
      },
    });
  } finally {
    clean();
    console.log("\n→ Removed the planted files and the broken .next output");
  }

  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  process.stdout.write(output);

  if (result.status === 0) {
    console.error(
      "\n✗ FAIL: `next build` succeeded.\n" +
        "  A Client Component imported src/server/api/koala.ts and nothing stopped it.\n" +
        '  Check that the file still begins with `import "server-only"`.',
    );
    process.exit(1);
  }

  const matched = EXPECTED_SIGNALS.filter((signal) => output.includes(signal));
  if (matched.length === 0) {
    console.error(
      "\n✗ FAIL: `next build` failed, but not for the expected reason.\n" +
        `  None of ${JSON.stringify(EXPECTED_SIGNALS)} appeared in the output.\n` +
        "  The guard may be fine and something else may be broken — read the log above.",
    );
    process.exit(1);
  }

  console.log(
    `\n✓ PASS: \`next build\` failed with exit code ${result.status}, ` +
      `citing ${JSON.stringify(matched)}.\n` +
      "  A Client Component cannot import the Koala API client.",
  );
}

main();
