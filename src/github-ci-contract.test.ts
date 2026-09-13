import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

describe("GitHub does not run the quality gate on PRs", () => {
  it("leaves the self-hosted jobs for an explicit dispatch only", async () => {
    const workflow = await readFile(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");

    expect(workflow).not.toMatch(/pull_request:/);
    expect(workflow).not.toContain("branches: [main]");
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("pnpm lint");
    expect(workflow).toContain("pnpm typecheck");
    expect(workflow).toContain("pnpm test");
    expect(workflow).toContain("pnpm build");
    expect(workflow).toContain("pnpm verify:server-only");
  });
});
