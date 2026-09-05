import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const alias = {
  "@": fileURLToPath(new URL("./src", import.meta.url)),
  /**
   * `server-only` throws on import outside a React Server Component, which is
   * exactly the guard this project relies on — and exactly what stops Vitest
   * from importing `src/server/api/koala.ts` at all.
   *
   * The stub only lifts that guard inside the test runner. It cannot mask a
   * real violation, because the guard is enforced by the Next.js bundler and
   * not by Vitest: `pnpm verify:server-only` proves the build still fails.
   */
  "server-only": fileURLToPath(new URL("./test/stubs/server-only.ts", import.meta.url)),
};

const env = {
  KOALA_API_BASE_URL: "http://koala-backend.test",
  KOALA_API_TIMEOUT_MS: "1000",
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts"],
          setupFiles: ["./test/setup.node.ts"],
          env,
        },
      },
      {
        plugins: [react()],
        resolve: { alias },
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["src/**/*.test.tsx"],
          setupFiles: ["./test/setup.dom.ts"],
          env,
        },
      },
    ],
  },
});
