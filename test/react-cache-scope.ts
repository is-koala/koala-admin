import React from "react";

/**
 * A stand-in for the request scope React gives a Server Component render.
 *
 * `cache(fn)` in the `react-server` build looks up `ReactSharedInternals.A` —
 * the async dispatcher React installs for the duration of one render — and
 * falls straight through to `fn` when there isn't one. Outside Next.js there
 * isn't one, so without this helper `getStaffContext()` would call
 * `GET /admin/me` once per caller in a test and the de-duplication ADR-0010
 * relies on would go unproven.
 *
 * The dispatcher below is the whole contract `cache()` uses: one
 * `getCacheForType(create)` map, created fresh per scope and dropped with it.
 * That is also the property under test — the memo lives exactly as long as the
 * request, and never a moment longer.
 *
 * `vitest.config.mts` aliases `react` to the `react-server` build for the node
 * project; the default build's `cache` is a pass-through and would make this
 * helper silently pointless, so it throws rather than pretend.
 */
const SERVER_INTERNALS = "__SERVER_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE";

interface AsyncDispatcher {
  getCacheForType<T>(create: () => T): T;
  cacheSignal(): AbortSignal | null;
}

function serverInternals(): { A: AsyncDispatcher | null } {
  const internals = (React as unknown as Record<string, { A: AsyncDispatcher | null } | undefined>)[
    SERVER_INTERNALS
  ];

  if (internals === undefined) {
    throw new Error(
      "React'in react-server derlemesi yüklenmemiş; vitest.config.mts'teki alias kayıp.",
    );
  }

  return internals;
}

/** Run `body` as if it were one Server Component render. */
export async function withReactCacheScope<T>(body: () => Promise<T>): Promise<T> {
  const internals = serverInternals();
  const previous = internals.A;
  const store = new Map<unknown, unknown>();

  internals.A = {
    getCacheForType<V>(create: () => V): V {
      if (!store.has(create)) store.set(create, create());
      return store.get(create) as V;
    },
    cacheSignal: () => null,
  };

  try {
    return await body();
  } finally {
    internals.A = previous;
  }
}
