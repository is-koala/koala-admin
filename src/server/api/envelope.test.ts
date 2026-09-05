import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  authenticationRequiredBody,
  endpointNotFoundBody,
  jobCategoriesSuccessBody,
  validationFailedBody,
} from "../../../test/fixtures/envelopes";

import {
  categoryForStatus,
  readCorrelationId,
  readResultMeta,
  toKoalaApiError,
  unwrapDataResult,
  unwrapResult,
  type EnvelopeContext,
} from "./envelope";
import { KoalaApiError } from "./errors";

const jobCategorySchema = z.object({
  id: z.string(),
  name: z.string(),
  code: z.string(),
  requiresInsurance: z.boolean(),
});

function context(overrides: Partial<EnvelopeContext> = {}): EnvelopeContext {
  return { status: 200, method: "GET", path: "/reference/job-categories", ...overrides };
}

describe("unwrapDataResult", () => {
  it("returns the validated data out of a SuccessDataResult body", () => {
    const { data, meta } = unwrapDataResult(
      jobCategoriesSuccessBody,
      z.array(jobCategorySchema),
      context(),
    );

    expect(data).toHaveLength(3);
    expect(data[0]).toEqual({
      id: "9a1c0f10-0001-4c00-8000-000000000005",
      name: "Barista",
      code: "BARISTA",
      requiresInsurance: false,
    });
    expect(meta.correlationId).toBe("7ebd4805-a27f-4c1a-b306-2d927c2fc55d");
    // Spring serialises HttpStatus with toString(), not as a number.
    expect(meta.httpStatus).toBe("200 OK");
  });

  it("throws when the data does not match the caller's schema", () => {
    const drifted = {
      ...jobCategoriesSuccessBody,
      data: [{ id: "x", name: "Barista", code: "BARISTA" }],
    };

    try {
      unwrapDataResult(drifted, z.array(jobCategorySchema), context());
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(KoalaApiError);
      const koala = error as KoalaApiError;
      expect(koala.errorCode).toBe("RESPONSE_SCHEMA_MISMATCH");
      expect(koala.errorCategory).toBe("UNEXPECTED");
      // The correlation id survives even a schema failure — it is the only way
      // to find the response that caused it.
      expect(koala.correlationId).toBe("7ebd4805-a27f-4c1a-b306-2d927c2fc55d");
      expect(koala.message).toContain("requiresInsurance");
    }
  });

  it("throws a KoalaApiError when the body is an ErrorResult", () => {
    expect(() =>
      unwrapDataResult(endpointNotFoundBody, z.unknown(), context({ status: 404 })),
    ).toThrow(KoalaApiError);
  });
});

describe("toKoalaApiError", () => {
  it("keeps every field of a well-formed ErrorResult", () => {
    const error = toKoalaApiError(
      endpointNotFoundBody,
      context({ status: 404, path: "/reference/nope" }),
    );

    expect(error.status).toBe(404);
    expect(error.errorCode).toBe("ENDPOINT_NOT_FOUND");
    expect(error.errorCategory).toBe("ENDPOINT_NOT_FOUND");
    expect(error.message).toBe("Böyle bir uç bulunamadı.");
    expect(error.resource).toBe("nope");
    expect(error.resourceId).toBeNull();
    expect(error.correlationId).toBe("917829b9-cb2c-4586-82d5-29da1c9a623f");
    expect(error.details).toEqual([]);
  });

  it("does not lose `details` on a validation failure", () => {
    const error = toKoalaApiError(validationFailedBody, context({ status: 400 }));

    expect(error.isValidationFailure).toBe(true);
    expect(error.errorCode).toBe("JOB_CATEGORY_INVALID");
    expect(error.resourceId).toBe("9a1c0f10-0001-4c00-8000-000000000001");
    expect(error.details).toEqual([
      { field: "name", message: "Ad boş olamaz." },
      { field: "code", message: "Kod benzersiz olmalı." },
    ]);
  });

  it("classifies an authentication failure so callers can branch on it", () => {
    const error = toKoalaApiError(authenticationRequiredBody, context({ status: 401 }));

    expect(error.errorCategory).toBe("AUTHENTICATION_REQUIRED");
    expect(error.isAuthFailure).toBe(true);
    expect(error.isForbidden).toBe(false);
  });

  it("salvages a body that is not a contract-shaped ErrorResult", () => {
    // A proxy 502 with an HTML body, reduced by the client to `{ message }`.
    const error = toKoalaApiError(
      { message: "<html>502 Bad Gateway</html>" },
      context({ status: 502, path: "/reference/job-categories" }),
    );

    expect(error.status).toBe(502);
    expect(error.errorCategory).toBe("UPSTREAM_FAILED");
    expect(error.errorCode).toBe("UPSTREAM_FAILED");
    expect(error.message).toBe("<html>502 Bad Gateway</html>");
    expect(error.correlationId).toBeNull();
  });

  it("keeps the correlation id even when the rest of the envelope is unusable", () => {
    const error = toKoalaApiError(
      { correlationId: "aaaa-bbbb", nonsense: true },
      context({ status: 500 }),
    );

    expect(error.correlationId).toBe("aaaa-bbbb");
    expect(error.errorCategory).toBe("UPSTREAM_FAILED");
  });

  it("falls back to the status when errorCategory is not a known member", () => {
    // A category the backend added but this union has not caught up with yet.
    const error = toKoalaApiError(
      { ...endpointNotFoundBody, errorCategory: "QUOTA_EXCEEDED" },
      context({ status: 429 }),
    );

    expect(error.errorCategory).toBe("RATE_LIMITED");
    // The backend's own code is still preserved verbatim.
    expect(error.errorCode).toBe("ENDPOINT_NOT_FOUND");
  });
});

describe("unwrapResult", () => {
  it("returns the meta of a data-less success envelope", () => {
    const meta = unwrapResult(
      {
        success: true,
        message: "Silindi.",
        httpStatus: "204 NO_CONTENT",
        path: "/admin/job-categories/1",
        timeStamp: "2026-09-05T22:58:48.643136333Z",
        correlationId: "dddd",
      },
      context({ status: 204, method: "DELETE" }),
    );

    expect(meta.success).toBe(true);
    expect(meta.correlationId).toBe("dddd");
  });

  it("throws when the envelope reports failure", () => {
    expect(() => unwrapResult(authenticationRequiredBody, context({ status: 401 }))).toThrow(
      KoalaApiError,
    );
  });
});

describe("helpers", () => {
  it("reads the correlation id out of anything, or nothing", () => {
    expect(readCorrelationId(jobCategoriesSuccessBody)).toBe(
      "7ebd4805-a27f-4c1a-b306-2d927c2fc55d",
    );
    expect(readCorrelationId(null)).toBeNull();
    expect(readCorrelationId("not an object")).toBeNull();
    expect(readCorrelationId({ correlationId: 42 })).toBeNull();
  });

  it("returns null meta for a body that is not a Result", () => {
    expect(readResultMeta({ whatever: true })).toBeNull();
  });

  it("maps transport statuses onto categories", () => {
    expect(categoryForStatus(401)).toBe("AUTHENTICATION_REQUIRED");
    expect(categoryForStatus(403)).toBe("ACCESS_DENIED");
    expect(categoryForStatus(429)).toBe("RATE_LIMITED");
    expect(categoryForStatus(503)).toBe("UPSTREAM_FAILED");
    expect(categoryForStatus(418)).toBe("UNEXPECTED");
  });
});
