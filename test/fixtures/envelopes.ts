/**
 * Response bodies captured verbatim from a running koala-backend on
 * `http://localhost:8080` (2026-09-05). Hand-written fixtures drift; these do
 * not — note `httpStatus: "200 OK"` rather than `200`, the nanosecond precision
 * on `timeStamp`, and `resourceId` simply absent rather than null.
 */

/** `GET /reference/job-categories` */
export const jobCategoriesSuccessBody = {
  correlationId: "7ebd4805-a27f-4c1a-b306-2d927c2fc55d",
  data: [
    {
      id: "9a1c0f10-0001-4c00-8000-000000000005",
      name: "Barista",
      code: "BARISTA",
      requiresInsurance: false,
    },
    {
      id: "9a1c0f10-0001-4c00-8000-000000000001",
      name: "Fotoğrafçılık",
      code: "PHOTOGRAPHY",
      requiresInsurance: false,
    },
    {
      id: "9a1c0f10-0001-4c00-8000-000000000002",
      name: "Garsonluk",
      code: "WAITER",
      requiresInsurance: false,
    },
  ],
  httpStatus: "200 OK",
  message: "Liste getirildi.",
  path: "/reference/job-categories",
  success: true,
  timeStamp: "2026-09-05T22:58:48.643136333Z",
};

/** `GET /reference/nope` — no such endpoint. */
export const endpointNotFoundBody = {
  message: "Böyle bir uç bulunamadı.",
  httpStatus: "404 NOT_FOUND",
  errorCode: "ENDPOINT_NOT_FOUND",
  errorCategory: "ENDPOINT_NOT_FOUND",
  correlationId: "917829b9-cb2c-4586-82d5-29da1c9a623f",
  path: "/reference/nope",
  resource: "nope",
  success: false,
  timeStamp: "2026-09-05T22:58:54.787343086Z",
};

/** `GET /admin/job-categories` without a token. */
export const authenticationRequiredBody = {
  message: "You must be signed in to continue.",
  httpStatus: "401 UNAUTHORIZED",
  errorCode: "AUTHENTICATION_REQUIRED",
  errorCategory: "AUTHENTICATION_REQUIRED",
  correlationId: "47d40e1a-fabf-46d3-90e2-3d28f3d4476e",
  path: "/admin/job-categories",
  resource: "job-categories",
  success: false,
  timeStamp: "2026-09-05T22:58:54.830815753Z",
};

/**
 * A validation failure, shaped after `ErrorResult.withDetails(...)`. Same
 * envelope as the captured ones plus the `details` array, which is the field
 * most likely to be quietly dropped by an unwrapper.
 */
export const validationFailedBody = {
  message: "Doğrulama başarısız.",
  httpStatus: "400 BAD_REQUEST",
  errorCode: "JOB_CATEGORY_INVALID",
  errorCategory: "VALIDATION_FAILED",
  correlationId: "c0ffee00-1111-2222-3333-444455556666",
  path: "/admin/job-categories",
  resource: "job-categories",
  resourceId: "9a1c0f10-0001-4c00-8000-000000000001",
  success: false,
  timeStamp: "2026-09-05T22:59:00.000000000Z",
  details: [
    { field: "name", message: "Ad boş olamaz." },
    { field: "code", message: "Kod benzersiz olmalı." },
  ],
};
