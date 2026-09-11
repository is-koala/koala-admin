import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PageHeader } from "./page-header";

/**
 * The page title row every panel screen shares.
 *
 * The seam is the heading and the description the operator reads — not the
 * class names. Actions are optional: a lookup screen has a form in the body,
 * a queue might put nothing here.
 */

describe("PageHeader", () => {
  it("renders the screen title as the page heading", () => {
    render(
      <PageHeader
        title="Denetim kaydı"
        description="Personelin yaptığı işlemlerin kaydı — reddedilen denemeler dâhil."
      />,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Denetim kaydı" })).toBeInTheDocument();
    expect(
      screen.getByText("Personelin yaptığı işlemlerin kaydı — reddedilen denemeler dâhil."),
    ).toBeInTheDocument();
  });

  it("places optional actions next to the title", () => {
    render(
      <PageHeader title="Personel">
        <button type="button">Personel ekle</button>
      </PageHeader>,
    );

    expect(screen.getByRole("heading", { level: 1, name: "Personel" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Personel ekle" })).toBeInTheDocument();
  });
});
