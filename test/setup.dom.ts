import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll } from "vitest";

import { server } from "./msw";

/**
 * The same MSW server the node project uses, for the same reason: this project
 * now renders Server Components that talk to the backend, and the strongest
 * assertion about the permission gate is a request *count*. `onUnhandledRequest:
 * "error"` keeps an unstubbed call from quietly reaching the network instead.
 */
beforeAll(() => {
  server.listen({ onUnhandledRequest: "error" });
});

afterEach(() => {
  cleanup();
  server.resetHandlers();
});

afterAll(() => {
  server.close();
});
