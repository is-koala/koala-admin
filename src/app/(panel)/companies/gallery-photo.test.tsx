import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GalleryPhoto } from "./gallery-photo";

const SRC =
  "/api/companies/9c000000-0000-4000-8000-000000000001/images/a1000000-0000-4000-8000-0000000000aa/download";

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  fetchSpy.mockReset();
  vi.unstubAllGlobals();
});

describe("GalleryPhoto load failures", () => {
  it("replaces the broken tile with the BFF's reason and offers a retry", async () => {
    fetchSpy.mockResolvedValue(
      new Response(null, {
        status: 502,
        headers: { "X-Koala-Download-Error": "not_configured" },
      }),
    );
    const user = userEvent.setup();
    render(<GalleryPhoto src={SRC} alt="1. galeri fotoğrafı" />);

    fireEvent.error(screen.getByRole("img", { name: "1. galeri fotoğrafı" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Depo indirme kaynağı tanımlı değil (EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS).",
      ),
    );
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(fetchSpy).toHaveBeenCalledWith(SRC, expect.objectContaining({ method: "HEAD" }));

    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));

    expect(screen.getByRole("img", { name: "1. galeri fotoğrafı" })).toHaveAttribute(
      "src",
      `${SRC}?dene=1`,
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says 'not found' rather than blaming configuration on a 404", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 404 }));
    render(<GalleryPhoto src={SRC} alt="1. galeri fotoğrafı" />);

    fireEvent.error(screen.getByRole("img", { name: "1. galeri fotoğrafı" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Fotoğraf bulunamadı ya da bu kayda erişiminiz yok.",
      ),
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
  });
});
