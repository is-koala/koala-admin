import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { toKoalaApiError } from "@/server/api/envelope";

import { ErrorState } from "./error-state";

/**
 * The seam between the response envelope and the screen a support request is
 * read off, tested end to end because neither half is worth much alone.
 *
 * The envelope reader can carry the id perfectly and the screen can still drop
 * it; the screen can render whatever it is handed and still show nothing when
 * the reader looked for a field the backend no longer sends. Only rendering the
 * id that a real `ErrorResult` body arrived with proves the handle survives the
 * whole way, so that is what these tests do.
 */

const context = { status: 403, method: "GET", path: "/admin/reports" } as const;

/**
 * `GET /admin/reports` refused, shaped as koala-backend now serialises
 * `ErrorResult`: the id arrives as `requestId` and under no other name. The
 * absence of a second spelling is the point — there is no compatibility copy to
 * fall back on, so a reader looking for the old field finds nothing at all.
 */
const forbiddenBody = {
  success: false,
  message: "Bu işlem için yetkiniz yok.",
  httpStatus: "403 FORBIDDEN",
  errorCode: "ACCESS_DENIED",
  errorCategory: "ACCESS_DENIED",
  requestId: "9f6c1d2e-7b40-4a55-8c31-1e0a5d7b2f44",
  path: "/admin/reports",
  timeStamp: "2026-09-06T09:14:22.481907113Z",
};

describe("the request id survives from the envelope to the error screen", () => {
  it("shows the id the backend sent, so a support request can quote it", () => {
    const error = toKoalaApiError(forbiddenBody, context);

    render(
      <ErrorState
        title="Şikayet kuyruğu yüklenemedi."
        description={error.message}
        errorCode={error.errorCode}
        requestId={error.requestId}
      />,
    );

    // On screen on purpose: without it a support request is "the page was
    // broken around lunchtime".
    expect(screen.getByRole("alert")).toHaveTextContent("9f6c1d2e-7b40-4a55-8c31-1e0a5d7b2f44");
  });

  /**
   * The operator reading this screen is reading a Turkish panel. Asserting the
   * whole label set, rather than the one label under test, is what keeps a wire
   * field name from leaking into the UI as its own English caption.
   */
  it("labels the id in Turkish, like every other label on the screen", () => {
    const error = toKoalaApiError(forbiddenBody, context);

    render(
      <ErrorState
        title="Şikayet kuyruğu yüklenemedi."
        errorCode={error.errorCode}
        requestId={error.requestId}
      />,
    );

    const alert = screen.getByRole("alert");
    const labels = [...alert.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(labels).toEqual(["Hata kodu:", "İstek numarası:"]);

    const values = [...alert.querySelectorAll("dd")].map((dd) => dd.textContent);
    expect(values).toEqual(["ACCESS_DENIED", "9f6c1d2e-7b40-4a55-8c31-1e0a5d7b2f44"]);
  });
});
