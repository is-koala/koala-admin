import "server-only";

import type { z } from "zod";

import { env } from "@/env";

import { toKoalaApiError, unwrapDataResult, unwrapResult, type EnvelopeContext } from "./envelope";
import { KoalaApiError } from "./errors";
import { logKoalaFailure } from "./logging";
import type { KoalaResultMeta } from "./types";

/**
 * The Koala backend client — and the boundary the whole panel is built on.
 *
 * `import "server-only"` on line 1 is not decoration. It is the single line
 * that keeps the browser from ever talking to `api.iskoala.com` directly: if a
 * Client Component imports this module, the build fails. Three things follow
 * from that, and all three are why the rule exists:
 *
 *  1. The access token never reaches browser JavaScript. The panel's permission
 *     set includes `payout.release`; an XSS that could read the token could
 *     release money out of escrow.
 *  2. The backend's CORS allow-list (`core/configs/CorsConfig.java`) never needs
 *     an `admin.iskoala.com` entry, because no browser request is ever made.
 *  3. `X-Device-Id` / `X-App-Version` never enter the picture — see
 *     `buildKoalaHeaders` below.
 *
 * Run `pnpm verify:server-only` to see the guard actually fire.
 */

/**
 * The backend resolves message language with `AcceptHeaderLocaleResolver`
 * (`core/configs/MultiLanguageSupportConfig.java`) and defaults to `tr`. The
 * panel is Turkish-only for now, so this is a constant rather than a parameter.
 */
export const KOALA_ACCEPT_LANGUAGE = "tr";

export type KoalaHttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export type KoalaQueryValue = string | number | boolean | null | undefined;

export interface KoalaRequestOptions {
  /** Root-relative path, e.g. `/reference/job-categories`. */
  path: string;
  method?: KoalaHttpMethod;
  query?: Record<string, KoalaQueryValue>;
  /** Serialised as JSON. Omit for GET/DELETE. */
  body?: unknown;
  /**
   * Access token for `/admin/**` calls. Resolved server-side by the auth slice
   * (issue #4); this slice only calls unauthenticated endpoints, so it is
   * optional and simply omitted when absent.
   */
  accessToken?: string | null;
  signal?: AbortSignal;
  /** Overrides `KOALA_API_TIMEOUT_MS` for a single call. */
  timeoutMs?: number;
  cache?: RequestCache;
  revalidate?: number | false;
  tags?: readonly string[];
}

export interface KoalaDataRequestOptions<T> extends KoalaRequestOptions {
  /**
   * Required, not optional. Callers get a validated `T` instead of `any`, and a
   * backend response that drifts from the contract fails loudly at the boundary
   * rather than silently as `undefined` deep inside a component.
   */
  schema: z.ZodType<T>;
}

/** Type of the `next` field Next.js adds to `RequestInit`. */
interface NextFetchOptions {
  revalidate?: number | false;
  tags?: string[];
}

export function buildKoalaUrl(path: string, query?: Record<string, KoalaQueryValue>): string {
  const normalisedPath = path.startsWith("/") ? path : `/${path}`;
  // The backend has no servlet context-path; endpoints hang off the root.
  const url = new URL(`${env.KOALA_API_BASE_URL}${normalisedPath}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === null || value === undefined) continue;
    url.searchParams.set(key, String(value));
  }

  return url.toString();
}

/**
 * The complete set of headers the panel ever sends to the Koala backend.
 *
 * Deliberately absent: `X-Device-Id` and `X-App-Version`. Those belong to the
 * mobile/web client contract. `core/configs/MinimumAppVersionFilter.java` lets
 * a request through when they are missing, and `/admin/**` is moving to its own
 * filter chain (koala-backend#14) — so sending them would buy nothing and would
 * quietly enrol the panel in a version gate meant for a different client.
 * `forbidden-headers.test.ts` greps `src/` on every CI run, so reintroducing
 * either header fails the build rather than a code review.
 */
export function buildKoalaHeaders(options: {
  accessToken?: string | null;
  hasJsonBody?: boolean;
}): Headers {
  const headers = new Headers();

  headers.set("Accept", "application/json");
  headers.set("Accept-Language", KOALA_ACCEPT_LANGUAGE);

  if (options.hasJsonBody === true) {
    headers.set("Content-Type", "application/json");
  }

  const token = options.accessToken;
  if (typeof token === "string" && token.length > 0) {
    headers.set("Authorization", `Bearer ${token}`);
  }

  return headers;
}

function resolveSignal(options: KoalaRequestOptions): AbortSignal {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? env.KOALA_API_TIMEOUT_MS);
  return options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
}

function transportError(cause: unknown, context: EnvelopeContext): KoalaApiError {
  const isTimeout = cause instanceof Error && cause.name === "TimeoutError";
  const isAbort = cause instanceof Error && cause.name === "AbortError";

  const [errorCode, message] = isTimeout
    ? ["REQUEST_TIMEOUT", "Koala API zaman aşımına uğradı"]
    : isAbort
      ? ["REQUEST_ABORTED", "Koala API isteği iptal edildi"]
      : ["NETWORK_FAILURE", "Koala API'ye ulaşılamadı"];

  return new KoalaApiError({
    status: 0,
    errorCode,
    errorCategory: "UPSTREAM_FAILED",
    message: `${message} (${context.method} ${context.path}).`,
    // No response, so no correlation id exists to log. `-` in the log line.
    correlationId: null,
    path: context.path,
    method: context.method,
    cause,
  });
}

/** Normalises anything thrown into a `KoalaApiError`, logs it once, returns it. */
function reportFailure(error: unknown, context: EnvelopeContext): KoalaApiError {
  const normalised =
    error instanceof KoalaApiError
      ? error
      : new KoalaApiError({
          status: context.status,
          errorCode: "UNEXPECTED",
          errorCategory: "UNEXPECTED",
          message:
            error instanceof Error
              ? error.message
              : `Koala API çağrısı beklenmedik şekilde başarısız oldu (${context.method} ${context.path}).`,
          path: context.path,
          method: context.method,
          cause: error,
        });

  logKoalaFailure(normalised);
  return normalised;
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    // An HTML error page from a proxy, a truncated body, ...
    return { message: text.slice(0, 500) };
  }
}

async function execute(
  options: KoalaRequestOptions,
  context: EnvelopeContext,
): Promise<{ status: number; body: unknown }> {
  const method = options.method ?? "GET";
  const hasJsonBody = options.body !== undefined && method !== "GET";

  const next: NextFetchOptions = {};
  if (options.revalidate !== undefined) next.revalidate = options.revalidate;
  if (options.tags !== undefined) next.tags = [...options.tags];

  const init: RequestInit & { next?: NextFetchOptions } = {
    method,
    headers: buildKoalaHeaders({ accessToken: options.accessToken, hasJsonBody }),
    signal: resolveSignal(options),
    ...(hasJsonBody ? { body: JSON.stringify(options.body) } : {}),
    ...(options.cache !== undefined ? { cache: options.cache } : {}),
    ...(Object.keys(next).length > 0 ? { next } : {}),
  };

  let response: Response;
  try {
    response = await fetch(buildKoalaUrl(options.path, options.query), init);
  } catch (cause) {
    throw transportError(cause, context);
  }

  context.status = response.status;
  return { status: response.status, body: await readBody(response) };
}

/**
 * Perform a request and return the unwrapped, schema-validated `data`.
 * Throws {@link KoalaApiError} — and only {@link KoalaApiError} — on failure.
 */
export async function koalaRequest<T>(options: KoalaDataRequestOptions<T>): Promise<T> {
  const context: EnvelopeContext = {
    status: 0,
    method: options.method ?? "GET",
    path: options.path,
  };

  try {
    const { status, body } = await execute(options, context);

    if (status < 200 || status >= 300) {
      throw toKoalaApiError(body, context);
    }

    return unwrapDataResult(body, options.schema, context).data;
  } catch (error) {
    throw reportFailure(error, context);
  }
}

/** Same, for endpoints whose `Result` carries no `data`. */
export async function koalaRequestNoData(options: KoalaRequestOptions): Promise<KoalaResultMeta> {
  const context: EnvelopeContext = {
    status: 0,
    method: options.method ?? "GET",
    path: options.path,
  };

  try {
    const { status, body } = await execute(options, context);

    if (status < 200 || status >= 300) {
      throw toKoalaApiError(body, context);
    }

    return unwrapResult(body, context);
  } catch (error) {
    throw reportFailure(error, context);
  }
}

type BodylessOptions<T> = Omit<KoalaDataRequestOptions<T>, "method" | "body">;
type BodyOptions<T> = Omit<KoalaDataRequestOptions<T>, "method">;

export const koalaApi = {
  get: <T>(options: BodylessOptions<T>): Promise<T> => koalaRequest({ ...options, method: "GET" }),
  post: <T>(options: BodyOptions<T>): Promise<T> => koalaRequest({ ...options, method: "POST" }),
  put: <T>(options: BodyOptions<T>): Promise<T> => koalaRequest({ ...options, method: "PUT" }),
  patch: <T>(options: BodyOptions<T>): Promise<T> => koalaRequest({ ...options, method: "PATCH" }),
  delete: <T>(options: BodyOptions<T>): Promise<T> =>
    koalaRequest({ ...options, method: "DELETE" }),
} as const;
