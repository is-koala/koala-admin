/**
 * Test-only stand-in for the `server-only` package.
 *
 * The real module throws the moment it is imported anywhere but a React Server
 * Component, so without this alias Vitest could not import
 * `src/server/api/koala.ts` at all.
 *
 * This does not weaken the guard. The guard lives in the Next.js bundler, which
 * this alias never touches: `pnpm verify:server-only` plants a Client Component
 * that imports the client and asserts `next build` fails.
 */
export {};
