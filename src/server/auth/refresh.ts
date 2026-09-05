import "server-only";

import { env } from "@/env";

import { getKeycloakEndpoints } from "./discovery";
import { isStaffAuthError } from "./errors";

/**
 * The refresh grant, and the one rule that makes it dangerous:
 *
 * **a rotated refresh token may be spent exactly once.** The realm runs with
 * `revokeRefreshToken` on and `refreshTokenMaxReuse: 0`, so presenting the same
 * refresh token twice does not fail that one call — Keycloak treats it as a
 * stolen token and revokes the entire SSO session. Everyone signed in on that
 * session is thrown out.
 *
 * Concurrency makes that easy to hit by accident. A single page view fans out
 * into the proxy plus several server renders, all holding the same cookie, all
 * arriving within milliseconds of expiry. Without coordination each one sends
 * the same refresh token and the second answer kills the session.
 *
 * So every refresh goes through {@link refreshAccessToken}, which keys in-flight
 * calls by the refresh token being spent. Callers that arrive while a refresh is
 * running await the same promise, and callers that arrive shortly after it
 * finished still get its result instead of re-spending a token that is already
 * gone — see {@link SETTLED_TTL_MS}.
 */

export interface RefreshedTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly idToken: string | null;
  /** Epoch milliseconds. */
  readonly expiresAt: number;
}

export type RefreshOutcome =
  /** Keycloak issued a new token set. The old refresh token is now spent. */
  | { readonly status: "refreshed"; readonly tokens: RefreshedTokens }
  /**
   * Keycloak answered and said no — expired, revoked, or already spent. The
   * session is over; nothing the panel does will bring it back.
   */
  | { readonly status: "rejected"; readonly reason: string }
  /**
   * Keycloak did not answer. Different from `rejected` in one decisive way:
   * the session may still be perfectly valid, so the refresh token is worth
   * keeping and retrying. The access token is not — see the `jwt` callback.
   */
  | { readonly status: "unreachable"; readonly reason: string };

interface Entry {
  readonly promise: Promise<RefreshOutcome>;
  /** `Infinity` while the call is in flight. */
  validUntil: number;
}

/**
 * Kept on `globalThis`, not in a module-level `const`.
 *
 * Next.js compiles `src/proxy.ts` into its own bundle, separate from the app
 * server's. A module-level map would therefore be *two* maps in one process —
 * and the proxy is exactly where refreshes happen, with the server rendering
 * the same request right behind it. Two maps means two refreshes with one
 * token, which is the failure this whole module exists to prevent.
 *
 * Note the honest limit: this is per-process. Two panel instances behind a load
 * balancer can still race. Fixing that needs shared storage and is not this
 * slice's problem — a sticky session or a single instance covers it until then.
 */
const globalCache = globalThis as typeof globalThis & {
  __koalaRefreshInFlight?: Map<string, Entry>;
};

const inFlight: Map<string, Entry> = (globalCache.__koalaRefreshInFlight ??= new Map());

/**
 * How long a completed refresh keeps answering for the token it spent.
 *
 * The window is not an optimisation. Auth.js can only write the rotated cookie
 * from the proxy's response; a server render inside the *same* request still
 * reads the old cookie and asks to refresh the same token again. Without this
 * window that second ask reaches Keycloak and revokes the session. With it, the
 * render gets the token its own request already minted, and the browser has the
 * new cookie before the next request.
 */
const SETTLED_TTL_MS = 30_000;

/** A refresh that has not answered in this long is treated as unreachable. */
const REFRESH_TIMEOUT_MS = 10_000;

/**
 * Refresh a token set, sharing one call per refresh token.
 *
 * Never rejects: every failure is an outcome, because the callers (the `jwt`
 * callback and the server-side token accessor) have to decide between "sign in
 * again" and "Keycloak is down" and a thrown error erases that distinction.
 */
export function refreshAccessToken(
  refreshToken: string,
  /**
   * Carried through so a refresh that omits `id_token` does not lose it.
   * Safe to share across de-duplicated callers: they hold the same refresh
   * token, so by construction they hold the same id token too.
   */
  previousIdToken: string | null = null,
): Promise<RefreshOutcome> {
  const now = Date.now();
  pruneExpired(now);

  const key = cacheKey(refreshToken);
  const existing = inFlight.get(key);
  if (existing !== undefined && existing.validUntil > now) {
    return existing.promise;
  }

  const promise = performRefresh(refreshToken, previousIdToken);
  const entry: Entry = { promise, validUntil: Number.POSITIVE_INFINITY };
  inFlight.set(key, entry);

  void promise.then(
    (outcome) => {
      if (inFlight.get(key) !== entry) return;

      if (outcome.status === "refreshed") {
        // Keep answering for the token we just spent.
        entry.validUntil = Date.now() + SETTLED_TTL_MS;
      } else {
        // A rejection is final and a network failure should be retried at once;
        // caching either one would only delay the truth.
        inFlight.delete(key);
      }
    },
    () => {
      inFlight.delete(key);
    },
  );

  return promise;
}

/** Exposed for tests; production code never needs to reach in here. */
export function clearRefreshCache(): void {
  inFlight.clear();
}

export function inFlightRefreshCount(): number {
  return inFlight.size;
}

function pruneExpired(now: number): void {
  for (const [key, entry] of inFlight) {
    if (entry.validUntil <= now) inFlight.delete(key);
  }
}

/**
 * A stable key that is not the secret itself. `djb2` is enough: the map is
 * process-local and a collision would at worst hand a caller the wrong
 * outcome, which the `jwt` callback then treats as a failed refresh. Hashing
 * keeps the raw refresh token out of anything that might get dumped in a
 * diagnostic.
 */
function cacheKey(refreshToken: string): string {
  let hash = 5381;
  for (let index = 0; index < refreshToken.length; index += 1) {
    hash = ((hash << 5) + hash + refreshToken.charCodeAt(index)) | 0;
  }
  return `${hash.toString(36)}:${refreshToken.length}`;
}

function describe(body: unknown): string {
  if (typeof body !== "object" || body === null) return "bilinmeyen hata";
  const record = body as Record<string, unknown>;
  const code = typeof record.error === "string" ? record.error : "bilinmeyen hata";
  const description =
    typeof record.error_description === "string" ? `: ${record.error_description}` : "";
  return `${code}${description}`;
}

async function performRefresh(
  refreshToken: string,
  previousIdToken: string | null,
): Promise<RefreshOutcome> {
  let tokenEndpoint: string;
  try {
    ({ tokenEndpoint } = await getKeycloakEndpoints());
  } catch (cause) {
    return {
      status: "unreachable",
      reason: isStaffAuthError(cause) ? cause.message : "Keycloak discovery başarısız",
    };
  }

  let response: Response;
  try {
    response = await fetch(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: env.KEYCLOAK_CLIENT_ID,
        client_secret: env.KEYCLOAK_CLIENT_SECRET,
      }),
      cache: "no-store",
      signal: AbortSignal.timeout(REFRESH_TIMEOUT_MS),
    });
  } catch (cause) {
    return {
      status: "unreachable",
      reason: cause instanceof Error ? cause.message : "Keycloak token ucuna ulaşılamadı",
    };
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    // 5xx is the realm having a bad day, not a verdict on this token. Treating
    // it as a rejection would sign everyone out over a restart.
    return response.status >= 500
      ? { status: "unreachable", reason: `Keycloak ${response.status}: ${describe(body)}` }
      : { status: "rejected", reason: describe(body) };
  }

  const tokens = readTokenResponse(body, refreshToken, previousIdToken);
  return tokens === null
    ? { status: "rejected", reason: "Keycloak yanıtı access_token içermiyor" }
    : { status: "refreshed", tokens };
}

/**
 * `refresh_token` is absent when rotation is off, and `id_token` is absent on
 * some refreshes; in both cases the previous value is still the current one.
 * Losing the id token silently would break RP-initiated logout, which has no
 * other way to prove who is logging out.
 */
export function readTokenResponse(
  body: unknown,
  previousRefreshToken: string,
  previousIdToken: string | null = null,
  now: number = Date.now(),
): RefreshedTokens | null {
  if (typeof body !== "object" || body === null) return null;
  const record = body as Record<string, unknown>;

  const accessToken = record.access_token;
  if (typeof accessToken !== "string" || accessToken.length === 0) return null;

  const expiresIn = typeof record.expires_in === "number" ? record.expires_in : 300;

  return {
    accessToken,
    refreshToken:
      typeof record.refresh_token === "string" && record.refresh_token.length > 0
        ? record.refresh_token
        : previousRefreshToken,
    idToken:
      typeof record.id_token === "string" && record.id_token.length > 0
        ? record.id_token
        : previousIdToken,
    expiresAt: now + expiresIn * 1000,
  };
}
