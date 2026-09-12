import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { DocumentPhoto } from "./document-photo";

const REVIEW_ID = "a1000000-0000-4000-8000-000000000001";
const DOCUMENT_ID = "e5000000-0000-4000-8000-000000000005";

describe("DocumentPhoto load failures", () => {
  it("shows a Turkish error and retry instead of a successful photo when the image errors", async () => {
    const user = userEvent.setup();
    render(
      <DocumentPhoto
        reviewId={REVIEW_ID}
        documentId={DOCUMENT_ID}
        label="Yüz"
        emptyLabel="Yüz fotoğrafı yok"
        alt="Yüz fotoğrafı"
      />,
    );

    fireEvent.error(screen.getByRole("img", { name: "Yüz fotoğrafı" }));

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Fotoğraf yüklenemedi.");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Tekrar dene" }));

    const retried = screen.getByRole("img", { name: "Yüz fotoğrafı" });
    expect(retried).toBeInTheDocument();
    expect(retried).toHaveAttribute(
      "src",
      expect.stringContaining(
        `/api/identity-verifications/${REVIEW_ID}/documents/${DOCUMENT_ID}/download`,
      ),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
