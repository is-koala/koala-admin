import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentPhoto } from "./document-photo";

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "e5000000-0000-4000-8000-000000000005";
const SRC = `/api/identity-verifications/${REVIEW_ID}/documents/${DOCUMENT_ID}/download`;

const fetchSpy = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchSpy);
});

afterEach(() => {
  fetchSpy.mockReset();
  vi.unstubAllGlobals();
});

function answer(status: number, reason?: string) {
  fetchSpy.mockResolvedValue(
    new Response(null, {
      status,
      headers: reason === undefined ? {} : { "X-Koala-Download-Error": reason },
    }),
  );
}

function renderPhoto() {
  return render(
    <DocumentPhoto
      reviewId={REVIEW_ID}
      documentId={DOCUMENT_ID}
      label="Yüz"
      emptyLabel="Yüz fotoğrafı yok"
      alt="Yüz fotoğrafı"
    />,
  );
}

describe("DocumentPhoto load failures", () => {
  it("shows a Turkish error and retry instead of a successful photo when the image errors", async () => {
    answer(502, "upstream");
    const user = userEvent.setup();
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Fotoğraf yüklenemedi.");
    expect(alert).toHaveTextContent("Bu kutu onaylanmış bir fotoğraf değildir.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));

    const retried = screen.getByRole("img", { name: "Yüz fotoğrafı" });
    expect(retried).toBeInTheDocument();
    expect(retried).toHaveAttribute("src", expect.stringContaining(SRC));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  /**
   * koala-admin#93: kırık img'den "yetki yok" ile "depo origin'i izin listesinde
   * değil" ayırt edilemez. Kutu aynı adrese HEAD atar ve iki farklı cümle söyler.
   */
  it("asks the BFF with HEAD after the image fails and says 'not found' on 404", async () => {
    answer(404);
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Fotoğraf bulunamadı ya da bu kayda erişiminiz yok.",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bu kutu onaylanmış bir fotoğraf değildir.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe(SRC);
    expect(init).toMatchObject({ method: "HEAD", cache: "no-store" });
  });

  it("names the env key on a 502 the BFF attributes to an empty allowlist", async () => {
    answer(502, "not_configured");
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Depo indirme kaynağı tanımlı değil (EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS). Sunucu günlüğüne bakın.",
      ),
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Bu kutu onaylanmış bir fotoğraf değildir.",
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("bulunamadı");
  });

  it("points at the allowlist, not the record, when the origin is merely not listed", async () => {
    answer(502, "origin_not_allowed");
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Depo indirme kaynağı izin listesinde yok (EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS).",
      ),
    );
  });

  it("tells the reviewer to retry when storage itself did not answer", async () => {
    answer(502, "upstream");
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Depo yanıt vermedi; tekrar deneyin."),
    );
    expect(screen.getByRole("alert")).not.toHaveTextContent("EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS");
  });

  it("keeps the generic sentence when the diagnosis request itself fails", async () => {
    fetchSpy.mockRejectedValue(new TypeError("Failed to fetch"));
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(
        "İndirme veya görüntüleme başarısız oldu. Bu kutu onaylanmış bir fotoğraf değildir.",
      ),
    );
  });

  it("does not let a late diagnosis knock out a retry that is already loading", async () => {
    let settle: (response: Response) => void = () => undefined;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          settle = resolve;
        }),
    );
    const user = userEvent.setup();
    renderPhoto();

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));
    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));
    await act(async () => {
      settle(new Response(null, { status: 404 }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.getByRole("img", { name: "Yüz fotoğrafı" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
