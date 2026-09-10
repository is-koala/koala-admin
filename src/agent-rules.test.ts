import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { hasCurrentAgentRules } from "next/dist/server/lib/generate-agent-files.js";
import { describe, expect, it } from "vitest";

import nextConfig from "../next.config";

/**
 * koala-admin#23: `pnpm dev` bu deponun ajan rehberini ezemesin.
 *
 * Next 16.3.4 ajan algılayınca kökte `AGENTS.md` / `CLAUDE.md` yazıyor
 * (`node_modules/next/dist/server/lib/generate-agent-files.js`). Üretilmiş
 * metin kendi commit edilmesini savunuyor; #18'in yazacağı gerçek rehber
 * o ada sahip. İki savunu, çünkü biri düşerse öbürü kalsın:
 *
 *  1. `next.config.ts` `agentRules: false` — `start-server.js` üretimi
 *     bu bayrağa bağlı, varsayılanı `true`.
 *  2. Commit'lenen dosyalar Next'in güncel bloğunu taşıyor —
 *     `hasCurrentAgentRules` o zaman no-op. Bayrak bir gün geri açılırsa
 *     `writeAgentFiles` yine #18 metninin üzerine yazmaz, bloğu yerinde
 *     bırakır.
 *
 * CLAUDE.md Next'in işaretçisi (`@AGENTS.md`); bağlayıcı içerik AGENTS.md.
 * AGENTS.md `.gitignore`'da olamaz: ignore, #18'in yazdığı rehberi
 * ajanın bağlamından çıkarır.
 */

const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));
const run = promisify(execFile);

describe("next dev cannot clobber the owned agent guide", () => {
  it("opts out of Next.js agent-file generation", () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  it("hosts the current Next.js agent-rules block, so generation is a no-op even if the flag is flipped", () => {
    expect(hasCurrentAgentRules(REPO_ROOT)).toBe(true);
  });

  it("keeps CLAUDE.md as Next's pointer at AGENTS.md, not a second guide", async () => {
    const claude = await readFile(path.join(REPO_ROOT, "CLAUDE.md"), "utf8");
    expect(claude.trimStart().startsWith("@AGENTS.md")).toBe(true);
  });

  it("tracks AGENTS.md instead of gitignoring it", async () => {
    const listed = await run("git", ["ls-files", "--", "AGENTS.md"], { cwd: REPO_ROOT });
    expect(listed.stdout.trim()).toBe("AGENTS.md");

    const ignore = await run("git", ["check-ignore", "-q", "--", "AGENTS.md"], {
      cwd: REPO_ROOT,
    }).then(
      () => 0,
      (error: NodeJS.ErrnoException & { code?: number | string }) =>
        typeof error.code === "number" ? error.code : 1,
    );
    expect(ignore).toBe(1);
  });
});
