/**
 * TypeScript mirror of the Koala backend response contract.
 *
 * Source of truth (koala-backend):
 *   core/utilities/results/Result.java
 *   core/utilities/results/DataResult.java
 *   core/utilities/results/SuccessDataResult.java
 *   core/utilities/results/ErrorResult.java
 *   core/utilities/results/ErrorCategory.java
 *   core/utilities/results/FieldError.java
 *   core/dtos/common/PageDto.java
 *
 * These types describe the wire format only. Nothing here talks to the network,
 * so this module is safe to import from a test.
 */

/**
 * `core/utilities/results/ErrorCategory.java` — a closed enum. Mirrored member
 * for member; if the backend adds a category, this union must be extended in
 * the same change.
 */
export const ERROR_CATEGORIES = [
  "RESOURCE_NOT_FOUND",
  "ENDPOINT_NOT_FOUND",
  "VALIDATION_FAILED",
  "REQUEST_MALFORMED",
  "PARAMETER_MISSING",
  "METHOD_NOT_ALLOWED",
  "MEDIA_TYPE_NOT_SUPPORTED",
  "BUSINESS_RULE_VIOLATION",
  "DATA_CONFLICT",
  "AUTHENTICATION_REQUIRED",
  "INVALID_CREDENTIALS",
  "TOKEN_EXPIRED",
  "ACCESS_DENIED",
  "RATE_LIMITED",
  "CLIENT_TOO_OLD",
  "UPSTREAM_FAILED",
  "UNEXPECTED",
] as const;

export type ErrorCategory = (typeof ERROR_CATEGORIES)[number];

export function isErrorCategory(value: unknown): value is ErrorCategory {
  return typeof value === "string" && (ERROR_CATEGORIES as readonly string[]).includes(value);
}

/**
 * `Result.java`. Present on every response, success or failure.
 *
 * `httpStatus` arrives as Spring's `HttpStatus.toString()` — `"200 OK"`,
 * `"404 NOT_FOUND"` — not as a number. Never parse business meaning out of it;
 * use the transport status code or `errorCategory` instead.
 *
 * `timeStamp` is an ISO-8601 instant in UTC (`2026-09-05T22:58:48.643136333Z`).
 * Note the nanosecond precision: `new Date(...)` truncates it, which is fine
 * for display but means it is not safe to round-trip.
 */
export interface KoalaResultMeta {
  success: boolean;
  message: string | null;
  httpStatus: string | null;
  path: string | null;
  timeStamp: string | null;
  /** Only way to line a panel error up with a backend log line. */
  requestId: string | null;
}

/** `DataResult.java` / `SuccessDataResult.java`. */
export interface KoalaDataResult<T> extends KoalaResultMeta {
  success: true;
  data: T;
}

/** `FieldError.java` — one entry per rejected field on a validation failure. */
export interface KoalaFieldError {
  field: string;
  message: string;
}

/**
 * `ErrorResult.java`. Serialised with `@JsonInclude(NON_NULL)`, so `resource`,
 * `resourceId` and `details` are simply absent when the backend has nothing to
 * say — hence the nullable types.
 */
export interface KoalaErrorResult extends KoalaResultMeta {
  success: false;
  errorCode: string;
  errorCategory: ErrorCategory;
  resource: string | null;
  resourceId: string | null;
  details: KoalaFieldError[] | null;
}

/** `core/dtos/common/PageDto.java`. `page` is zero-based. */
export interface PageDto<T> {
  content: T[];
  page: number;
  size: number;
  totalElements: number;
  totalPages: number;
  first: boolean;
  last: boolean;
}
