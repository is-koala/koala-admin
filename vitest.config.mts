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
 * The `react-server` build of React, which is what Next.js loads in a Server
 * Component and the only build where `cache()` actually memoises.
 *
 * The default build exports `cache` as a pass-through — literally
 * `function (fn) { return function () { return fn.apply(null, arguments); } }`
 * — so a test running against it cannot tell a `cache()`-wrapped function from
 * an unwrapped one, and `getStaffContext()`'s request-scoped de-duplication
 * (ADR-0010's one permitted memo) would be untestable.
 *
 * Node resolves the `react-server` export condition itself when Vitest
 * externalises a dependency, so an alias rather than `resolve.conditions` is
 * what takes effect. It applies to the `node` project only: the `dom` project
 * renders with `@testing-library/react`, which needs the client build.
 */
const reactServerBuild = fileURLToPath(
  new URL("./node_modules/react/react.react-server.js", import.meta.url),
);

/**
 * `src/env.ts` validates at import time and throws when anything is missing, so
 * every variable the schema requires has to exist here or no test that reaches
 * the server layer can even load.
 */
const env = {
  KOALA_API_BASE_URL: "http://koala-backend.test",
  KOALA_API_TIMEOUT_MS: "1000",
  // Plain http, so `buildSessionCookie` produces the non-`__Secure-` name the
  // cookie tests assert on — the same shape local development runs with.
  ADMIN_PUBLIC_ORIGIN: "http://localhost:3000",
  EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS: "https://storage.koala.test",
};

export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias: { ...alias, react: reactServerBuild } },
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
