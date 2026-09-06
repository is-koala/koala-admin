import { z } from "zod";

import { KoalaApiError } from "./errors";
import {
  ERROR_CATEGORIES,
  type ErrorCategory,
  type KoalaFieldError,
  type KoalaResultMeta,
} from "./types";

/**
 * Envelope reading, with no network in sight.
 *
 * The backend wraps every response — success or failure — in `Result`. This
 * module turns that envelope into either the caller's `data` or a typed
 * `KoalaApiError`, and it does so defensively: a body that does not match the
 * contract still produces a `KoalaApiError` carrying whatever could be salvaged
 * (above all the `correlationId`), never an unhandled `TypeError`.
 */

const nullableString = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

const resultMetaSchema = z.object({
  success: z.boolean(),
  message: nullableString,
  httpStatus: nullableString,
  path: nullableString,
  timeStamp: nullableString,
  correlationId: nullableString,
});

const fieldErrorSchema = z.object({
  field: z.string(),
  message: z.string(),
});

const errorResultSchema = resultMetaSchema.extend({
  success: z.literal(false),
  errorCode: z.string(),
  errorCategory: z.enum(ERROR_CATEGORIES),
  resource: nullableString,
  resourceId: nullableString,
  details: z
    .array(fieldErrorSchema)
    .nullish()
    .transform((value) => value ?? null),
});

/** Shape of a body that at least looks like a `Result`. */
const loosePartialSchema = z.object({
  success: z.boolean().nullish(),
  message: z.string().nullish(),
  correlationId: z.string().nullish(),
  path: z.string().nullish(),
  errorCode: z.string().nullish(),
  errorCategory: z.string().nullish(),
  resource: z.string().nullish(),
  resourceId: z.string().nullish(),
  details: z.array(fieldErrorSchema).nullish(),
});

export interface EnvelopeContext {
  /** HTTP status of the response; `0` when the request never completed. */
  status: number;
  method: string;
  /** Request path as the panel asked for it, e.g. `/reference/job-categories`. */
  path: string;
}

/**
 * Best-effort category when the backend did not give us one — a proxy 502, an
 * HTML error page, a body that failed to parse.
 */
export function categoryForStatus(status: number): ErrorCategory {
  switch (status) {
    case 400:
      return "REQUEST_MALFORMED";
    case 401:
      return "AUTHENTICATION_REQUIRED";
    case 403:
      return "ACCESS_DENIED";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 405:
      return "METHOD_NOT_ALLOWED";
    case 409:
      return "DATA_CONFLICT";
    case 415:
      return "MEDIA_TYPE_NOT_SUPPORTED";
    case 422:
      return "VALIDATION_FAILED";
    case 429:
      return "RATE_LIMITED";
    default:
      return status >= 500 ? "UPSTREAM_FAILED" : "UNEXPECTED";
  }
}

/**
 * Pull the correlation id out of anything. Used on the failure path where the
 * body may not match the contract at all — the id is the only handle we have
 * on the corresponding backend log line, so it is worth digging for.
 */
export function readCorrelationId(body: unknown): string | null {
  if (typeof body !== "object" || body === null) {
    return null;
  }

  const value = (body as { correlationId?: unknown }).correlationId;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Parse the shared `Result` fields. Returns `null` if the body is not one. */
export function readResultMeta(body: unknown): KoalaResultMeta | null {
  const parsed = resultMetaSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}

/**
 * Turn a failed response into a `KoalaApiError`.
 *
 * A well-formed `ErrorResult` keeps every field: `errorCode`, `errorCategory`
 * and `details` all survive. A malformed one is downgraded rather than dropped.
 */
export function toKoalaApiError(body: unknown, context: EnvelopeContext): KoalaApiError {
  const strict = errorResultSchema.safeParse(body);

  if (strict.success) {
    const error = strict.data;
    return new KoalaApiError({
      status: context.status,
      errorCode: error.errorCode,
      errorCategory: error.errorCategory,
      message: error.message ?? error.errorCode,
      details: error.details,
      correlationId: error.correlationId,
      resource: error.resource,
      resourceId: error.resourceId,
      path: error.path ?? context.path,
      method: context.method,
    });
  }

  // Not a contract-shaped `ErrorResult`. Salvage what is there.
  const loose = loosePartialSchema.safeParse(body);
  const salvaged = loose.success ? loose.data : null;
  const category = (() => {
    const raw = salvaged?.errorCategory;
    if (raw !== null && raw !== undefined) {
      const known = z.enum(ERROR_CATEGORIES).safeParse(raw);
      if (known.success) return known.data;
    }
    return categoryForStatus(context.status);
  })();

  const details: KoalaFieldError[] | null = salvaged?.details ?? null;

  return new KoalaApiError({
    status: context.status,
    errorCode: salvaged?.errorCode ?? category,
    errorCategory: category,
    message:
      salvaged?.message ??
      `Koala API isteği başarısız oldu (${context.method} ${context.path}, HTTP ${context.status}).`,
    details,
    correlationId: readCorrelationId(body),
    resource: salvaged?.resource ?? null,
    resourceId: salvaged?.resourceId ?? null,
    path: salvaged?.path ?? context.path,
    method: context.method,
  });
}

/**
 * Unwrap a `DataResult` body.
 *
 * `schema` is required rather than optional on purpose: it is what keeps `any`
 * out of every call site. The value a caller receives has been validated, so a
 * backend change that drops a field surfaces here as a `KoalaApiError` instead
 * of as `undefined` three components deep.
 */
export function unwrapDataResult<T>(
  body: unknown,
  schema: z.ZodType<T>,
  context: EnvelopeContext,
): { data: T; meta: KoalaResultMeta } {
  const meta = readResultMeta(body);

  if (meta === null || meta.success !== true) {
    throw toKoalaApiError(body, context);
  }

  const raw = (body as { data?: unknown }).data;
  const parsed = schema.safeParse(raw);

  if (!parsed.success) {
    throw new KoalaApiError({
      status: context.status,
      errorCode: "RESPONSE_SCHEMA_MISMATCH",
      errorCategory: "UNEXPECTED",
      message: [
        `Koala API yanıtı beklenen şemaya uymuyor (${context.method} ${context.path}).`,
        ...parsed.error.issues.map(
          (issue) => `  - ${issue.path.join(".") || "data"}: ${issue.message}`,
        ),
      ].join("\n"),
      correlationId: meta.correlationId,
      path: meta.path ?? context.path,
      method: context.method,
      cause: parsed.error,
    });
  }

  return { data: parsed.data, meta };
}

/** Unwrap a `Result` that carries no `data` (delete, acknowledge, ...). */
export function unwrapResult(body: unknown, context: EnvelopeContext): KoalaResultMeta {
  const meta = readResultMeta(body);

  if (meta === null || meta.success !== true) {
    throw toKoalaApiError(body, context);
  }

  return meta;
}
