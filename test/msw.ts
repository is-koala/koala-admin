import { setupServer } from "msw/node";

/**
 * One MSW server for the whole Node test project.
 *
 * Handlers are registered per test with `server.use(...)`, and
 * `onUnhandledRequest: "error"` makes a request nobody stubbed a test failure
 * rather than a real network call — which matters here, because the module
 * under test is the thing that talks to the backend.
 */
export const server = setupServer();

/** Base URL the tests pretend the backend lives at; matches `vitest.config.ts`. */
export const TEST_API_BASE_URL = "http://koala-backend.test";

export function apiUrl(path: string): string {
  return `${TEST_API_BASE_URL}${path}`;
}
