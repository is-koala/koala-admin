import type { ErrorCategory, KoalaFieldError } from "./types";

export interface KoalaApiErrorInit {
  status: number;
  errorCode: string;
  errorCategory: ErrorCategory;
  message: string;
  details?: readonly KoalaFieldError[] | null;
  requestId?: string | null;
  resource?: string | null;
  resourceId?: string | null;
  path?: string | null;
  method?: string | null;
  /** True only when the upstream body matched Koala's complete ErrorResult contract. */
  hasContractEnvelope?: boolean;
  cause?: unknown;
}

/**
 * The single failure type every Koala call can produce.
 *
 * Callers never see a raw `Response`, a `TypeError` from fetch, or `any`: a
 * transport failure, a non-2xx envelope and a malformed body all arrive here
 * with the same shape, so a caller can branch on `errorCategory` and nothing
 * else.
 */
export class KoalaApiError extends Error {
  override readonly name = "KoalaApiError";

  /** HTTP status of the response; `0` when the request never completed. */
  readonly status: number;
  readonly errorCode: string;
  readonly errorCategory: ErrorCategory;
  readonly details: readonly KoalaFieldError[];
  /** Request id echoed by the backend. Log it, always. */
  readonly requestId: string | null;
  readonly resource: string | null;
  readonly resourceId: string | null;
  readonly path: string | null;
  readonly method: string | null;
  /** Distinguishes an ErrorResult from fields salvaged out of proxy or malformed bodies. */
  readonly hasContractEnvelope: boolean;

  constructor(init: KoalaApiErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.status = init.status;
    this.errorCode = init.errorCode;
    this.errorCategory = init.errorCategory;
    this.details = init.details ?? [];
    this.requestId = init.requestId ?? null;
    this.resource = init.resource ?? null;
    this.resourceId = init.resourceId ?? null;
    this.path = init.path ?? null;
    this.method = init.method ?? null;
    this.hasContractEnvelope = init.hasContractEnvelope ?? false;
  }

  /** True when re-authenticating could plausibly fix the call. */
  get isAuthFailure(): boolean {
    return (
      this.errorCategory === "AUTHENTICATION_REQUIRED" ||
      this.errorCategory === "INVALID_CREDENTIALS" ||
      this.errorCategory === "TOKEN_EXPIRED"
    );
  }

  /** True when the user is signed in but not allowed to do this. */
  get isForbidden(): boolean {
    return this.errorCategory === "ACCESS_DENIED";
  }

  /** True when `details` carries per-field messages worth rendering on a form. */
  get isValidationFailure(): boolean {
    return this.errorCategory === "VALIDATION_FAILED";
  }
}

export function isKoalaApiError(value: unknown): value is KoalaApiError {
  return value instanceof KoalaApiError;
}
