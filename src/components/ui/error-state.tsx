import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface ErrorStateDetail {
  field: string;
  message: string;
}

export interface ErrorStateProps {
  title: string;
  description?: string;
  /**
   * The backend's `requestId`. Shown to the operator on purpose: it is what
   * turns "the page was broken" into a single grep in the backend log.
   */
  requestId?: string | null;
  /** `ErrorResult.errorCode`, e.g. `RESOURCE_NOT_FOUND`. */
  errorCode?: string | null;
  /** `ErrorResult.details` — per-field messages from a validation failure. */
  details?: readonly ErrorStateDetail[];
  action?: ReactNode;
  className?: string;
}

/**
 * "We could not load this" — deliberately never rendered for an empty result.
 * Presentational only: it takes plain strings, so it stays importable from
 * Client Components without dragging the server API layer along.
 */
export function ErrorState({
  title,
  description,
  requestId,
  errorCode,
  details,
  action,
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col gap-3 rounded-lg border border-danger/30 bg-danger-soft px-6 py-5",
        className,
      )}
    >
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold text-danger">{title}</p>
        {description ? <p className="max-w-prose text-sm text-ink">{description}</p> : null}
      </div>

      {details && details.length > 0 ? (
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-ink">
          {details.map((detail) => (
            <li key={`${detail.field}:${detail.message}`}>
              <span className="font-medium">{detail.field}</span>: {detail.message}
            </li>
          ))}
        </ul>
      ) : null}

      {errorCode || requestId ? (
        <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-ink-muted">
          {errorCode ? (
            <div className="flex gap-1">
              <dt>Hata kodu:</dt>
              <dd className="font-mono">{errorCode}</dd>
            </div>
          ) : null}
          {requestId ? (
            <div className="flex gap-1">
              <dt>İstek numarası:</dt>
              <dd className="font-mono break-all">{requestId}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}

      {action ? <div>{action}</div> : null}
    </div>
  );
}
