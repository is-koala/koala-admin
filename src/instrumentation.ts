/**
 * Runs once when the Next.js server boots, before it serves any request.
 *
 * Environment validation happens here, at startup, so a missing
 * `KOALA_API_BASE_URL` is reported immediately instead of surfacing as a
 * confusing `fetch failed` on the first page view.
 *
 * The work itself lives in `src/server/boot.ts` and is imported dynamically:
 * this file is bundled for the Edge runtime as well, and a static
 * `process.exit` reference makes the Edge build complain even inside a branch
 * that can never run there.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") {
    return;
  }

  const { validateEnvironmentOrExit } = await import("./server/boot");
  await validateEnvironmentOrExit();
}
