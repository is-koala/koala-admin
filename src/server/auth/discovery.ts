import "server-only";

import { env } from "@/env";

import { StaffAuthError } from "./errors";

/**
 * The two Keycloak endpoints the panel calls itself, read from the realm's
 * discovery document rather than assembled from the issuer by hand.
 *
 * Auth.js already does its own discovery for the login redirect. This module
 * exists for the two calls Auth.js does not make for us: the refresh grant and
 * RP-initiated logout. Hard-coding `/protocol/openid-connect/logout` would work
 * today and break silently the day the realm moves behind a path prefix, and a
 * broken logout is invisible — the local cookie still disappears, so it looks
 * like it worked while the Keycloak SSO session stays open.
 */
export interface KeycloakEndpoints {
  readonly tokenEndpoint: string;
  readonly endSessionEndpoint: string;
}

interface CacheEntry {
  readonly endpoints: KeycloakEndpoints;
  readonly issuer: string;
  readonly expiresAt: number;
}

/**
 * Cached on `globalThis` rather than in a module variable so the copy loaded by
 * `src/proxy.ts` and the copy loaded by the app server share it. Next.js gives
 * the proxy its own bundle, so a plain module-level constant would be two
 * caches in one process. Same reason as `refresh.ts` — and there the
 * consequence is not a wasted request but a revoked session.
 */
const globalCache = globalThis as typeof globalThis & {
  __koalaKeycloakDiscovery?: CacheEntry | undefined;
};

/** Discovery documents change roughly never; ten minutes is politeness, not caution. */
const CACHE_TTL_MS = 10 * 60 * 1000;
const DISCOVERY_TIMEOUT_MS = 5_000;

export function clearDiscoveryCache(): void {
  globalCache.__koalaKeycloakDiscovery = undefined;
}

function parseEndpoints(document: unknown): KeycloakEndpoints {
  const record = typeof document === "object" && document !== null ? document : {};
  const tokenEndpoint = (record as Record<string, unknown>).token_endpoint;
  const endSessionEndpoint = (record as Record<string, unknown>).end_session_endpoint;

  if (typeof tokenEndpoint !== "string" || typeof endSessionEndpoint !== "string") {
    throw new StaffAuthError(
      "KEYCLOAK_UNREACHABLE",
      "Keycloak discovery belgesi token_endpoint ya da end_session_endpoint içermiyor.",
    );
  }

  return { tokenEndpoint, endSessionEndpoint };
}

/**
 * @throws {StaffAuthError} with `KEYCLOAK_UNREACHABLE` when the realm does not
 * answer. Every caller turns that into the "Keycloak is down" page; none of
 * them may proceed without these URLs.
 */
export async function getKeycloakEndpoints(): Promise<KeycloakEndpoints> {
  const cached = globalCache.__koalaKeycloakDiscovery;
  if (cached && cached.issuer === env.KEYCLOAK_ISSUER && cached.expiresAt > Date.now()) {
    return cached.endpoints;
  }

  const url = `${env.KEYCLOAK_ISSUER}/.well-known/openid-configuration`;

  let response: Response;
  try {
    response = await fetch(url, {
      // Never let Next's fetch cache stand between the panel and the realm:
      // a cached failure would outlive the outage that caused it.
      cache: "no-store",
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new StaffAuthError("KEYCLOAK_UNREACHABLE", `Keycloak realm'ine ulaşılamadı (${url}).`, {
      cause,
    });
  }

  if (!response.ok) {
    throw new StaffAuthError(
      "KEYCLOAK_UNREACHABLE",
      `Keycloak realm'i ${response.status} döndürdü (${url}).`,
    );
  }

  const endpoints = parseEndpoints(await response.json());

  globalCache.__koalaKeycloakDiscovery = {
    endpoints,
    issuer: env.KEYCLOAK_ISSUER,
    expiresAt: Date.now() + CACHE_TTL_MS,
  };

  return endpoints;
}
