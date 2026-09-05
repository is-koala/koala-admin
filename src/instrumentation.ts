/**
 * Runs once when the Next.js server boots, before it serves any request.
 *
 * Importing `@/env` here is the whole point: environment validation happens at
 * startup, so a missing `KOALA_API_BASE_URL` is reported immediately instead of
 * surfacing as a confusing `fetch failed` on the first page view.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  try {
    await import("@/env");
  } catch (error) {
    // Next keeps the process alive when the instrumentation hook throws and
    // answers every request with a 500. A container that serves 500s still
    // looks alive to a load balancer, so exit instead: a crash loop with this
    // message in the log is unambiguous, a half-booted server is not.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
