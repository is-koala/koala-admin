import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("GitHub runs the quality gate on PRs", () => {
  it("runs the full gate on GitHub-hosted runners for PRs and main", async () => {
    const workflow = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).toMatch(/pull_request:\n\s+branches: \[main\]/);
    expect(workflow).toMatch(/push:\n\s+branches: \[main\]/);
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("runs-on: ubuntu-latest");
    expect(workflow).not.toContain("self-hosted");
    expect(workflow).toContain("pnpm lint");
    expect(workflow).toContain("pnpm format:check");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain("pnpm verify:server-only");
  });
});
