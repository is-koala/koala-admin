import { KoalaApiError } from "./errors";

/**
 * Every failed Koala call gets exactly one log line, and every line carries the
 * `correlationId` from the response envelope.
 *
 * That id is the only thing that ties a panel error to the backend log line
 * that produced it; without it a support request is "the page was broken around
 * lunchtime". `correlationId=-` means the backend never got far enough to mint
 * one (DNS failure, connection refused, timeout).
 */
export function logKoalaFailure(error: KoalaApiError): void {
  const fields: Array<[string, string | number]> = [
    ["method", error.method ?? "-"],
    ["path", error.path ?? "-"],
    ["status", error.status],
    ["category", error.errorCategory],
    ["code", error.errorCode],
    ["correlationId", error.correlationId ?? "-"],
  ];

  if (error.resource !== null) {
    fields.push(["resource", error.resource]);
  }
  if (error.resourceId !== null) {
    fields.push(["resourceId", error.resourceId]);
  }
  if (error.details.length > 0) {
    fields.push(["details", error.details.map((detail) => detail.field).join(",")]);
  }

  const prefix = fields.map(([key, value]) => `${key}=${value}`).join(" ");

  // First line of the message only: multi-line schema-mismatch reports would
  // otherwise break log-line-per-event parsing.
  const [summary] = error.message.split("\n");

  console.error(`[koala-api] ${prefix} message=${JSON.stringify(summary ?? "")}`);
}
