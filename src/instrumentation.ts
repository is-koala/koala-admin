/**
 * Runs once when the Next.js server boots, before it serves any request.
 *
 * Importing `@/env` here is the whole point: environment validation happens at
 * startup, so a missing `KOALA_API_BASE_URL` kills the process with a clear
 * message instead of surfacing as a confusing `fetch failed` on the first
 * page view.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  await import("@/env");
}
