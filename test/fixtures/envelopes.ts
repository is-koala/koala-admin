/**
 * Response bodies captured verbatim from a running koala-backend on
 * `http://localhost:8080` (2026-09-05). Hand-written fixtures drift; these do
 * not — note `httpStatus: "200 OK"` rather than `200`, the nanosecond precision
 * on `timeStamp`, and `resourceId` simply absent rather than null.
 */

/** `GET /reference/job-categories` */
export const jobCategoriesSuccessBody = {
  requestId: "7ebd4805-a27f-4c1a-b306-2d927c2fc55d",
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
  requestId: "917829b9-cb2c-4586-82d5-29da1c9a623f",
  path: "/reference/nope",
  resource: "nope",
  success: false,
  timeStamp: "2026-09-05T22:58:54.787343086Z",
};

/**
 * `GET /admin/reports/{id}` for an id the backend has no row for. Every
 * `*_NOT_FOUND` code shares the `RESOURCE_NOT_FOUND` category; that category,
 * inside a complete envelope, is what an object page turns into `notFound()`.
 * Compare `endpointNotFoundBody`: also 404, but the *endpoint* is missing, and
 * a page must not read that as "the record is gone".
 */
export const resourceNotFoundBody = {
  message: "Şikayet bulunamadı.",
  httpStatus: "404 NOT_FOUND",
  errorCode: "REPORT_NOT_FOUND",
  errorCategory: "RESOURCE_NOT_FOUND",
  requestId: "4f2a9c1e-7b3d-4e55-9a10-2c8d6f0b1e77",
  path: "/admin/reports/a1000000-0000-4000-8000-000000000001",
  resource: "report",
  resourceId: "a1000000-0000-4000-8000-000000000001",
  success: false,
  timeStamp: "2026-09-11T13:00:00.000000000Z",
};

/** `GET /admin/job-categories` without a token. */
export const authenticationRequiredBody = {
  message: "You must be signed in to continue.",
  httpStatus: "401 UNAUTHORIZED",
  errorCode: "AUTHENTICATION_REQUIRED",
  errorCategory: "AUTHENTICATION_REQUIRED",
  requestId: "47d40e1a-fabf-46d3-90e2-3d28f3d4476e",
  path: "/admin/job-categories",
  resource: "job-categories",
  success: false,
  timeStamp: "2026-09-05T22:58:54.830815753Z",
};

/**
 * `GET /admin/me` — the response koala-backend#14 was verified to produce.
 *
 * Note `roles` carries the transitively-included roles rather than only the
 * ones in the token, and both arrays arrive sorted. The panel reads `roles` as
 * evidence and `permissions` as authority; it never converts one into the
 * other (ADR-0010).
 */
export const adminMeSuccessBody = {
  success: true,
  message: "Personel kimliği çözüldü.",
  httpStatus: "200 OK",
  path: "/admin/me",
  requestId: "0d1b2b0f-1c8a-4a1e-9d4a-8f2c9a7b6e10",
  timeStamp: "2026-09-06T09:12:04.118273914Z",
  data: {
    staffId: "b7f4a2c1-0000-4c00-8000-000000000001",
    displayName: "Trust Lideri",
    email: "trust-lead@koala.local",
    roles: ["DISPUTE_HANDLER", "MODERATOR", "SUPPORT_AGENT", "TRUST_LEAD"],
    permissions: ["content.moderate", "dispute.resolve", "user.read", "user.read_pii"],
  },
};

/**
 * `GET /admin/me` refusing a token it accepted the signature of.
 *
 * Two situations produce this body and the panel cannot tell them apart from
 * the wire: no `staff_members` row for the token's subject, and an account still
 * carrying the "change your password first" flag — the backend denies every
 * `@RequiresPermission` endpoint in both cases.
 */
export const adminMeNoStaffRecordBody = {
  success: false,
  message: "Bu hesap için personel kaydı bulunamadı.",
  httpStatus: "403 FORBIDDEN",
  errorCode: "STAFF_NOT_FOUND",
  errorCategory: "ACCESS_DENIED",
  requestId: "3f5a1c88-91f0-4c5b-9c02-5b6a1f0d9e77",
  path: "/admin/me",
  timeStamp: "2026-09-06T09:12:41.902118004Z",
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
  requestId: "c0ffee00-1111-2222-3333-444455556666",
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
