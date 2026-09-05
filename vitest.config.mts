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

/**
 * `src/env.ts` validates at import time and throws when anything is missing, so
 * every variable the schema requires has to exist here or no test that reaches
 * the server layer can even load.
 */
const env = {
  KOALA_API_BASE_URL: "http://koala-backend.test",
  KOALA_API_TIMEOUT_MS: "1000",
  AUTH_URL: "http://localhost:3000",
  // Test-only, and long enough to satisfy the 32-character minimum.
  AUTH_SECRET: "test-secret-test-secret-test-secret-32",
  KEYCLOAK_ISSUER: "http://localhost:8085/realms/koala-staff",
  KEYCLOAK_CLIENT_ID: "koala-admin-web",
  KEYCLOAK_CLIENT_SECRET: "test-client-secret",
  KOALA_API_AUDIENCE: "koala-api",
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
