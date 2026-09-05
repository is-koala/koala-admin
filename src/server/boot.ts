import "server-only";

/**
 * Startup checks that run once, in the Node.js server runtime, before the first
 * request. Kept out of `src/instrumentation.ts` because that file is also
 * bundled for the Edge runtime, where `process.exit` does not exist — Turbopack
 * warns about it even inside a branch that can never run there.
 */
export async function validateEnvironmentOrExit(): Promise<void> {
  try {
    await import("@/env");
  } catch (error) {
    // Next keeps the process alive when the instrumentation hook throws and
    // answers every request with a 500. A container serving 500s still looks
    // alive to a load balancer, so exit instead: a crash loop with this message
    // in the log is unambiguous, a half-booted server is not.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
