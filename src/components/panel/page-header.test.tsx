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

  it("does not draw a location nav when no breadcrumb is given", () => {
    render(<PageHeader title="Ayarlar" />);

    expect(screen.queryByRole("navigation", { name: "Konum" })).not.toBeInTheDocument();
  });

  /** koala-admin#112: konum "liste › nesne"; liste bağlantı, nesne geçerli sayfa. */
  it("draws the breadcrumb as a Konum nav with the current page last and unlinked", () => {
    render(
      <PageHeader
        title="Kullanıcı"
        breadcrumb={[
          { label: "Kullanıcılar", href: "/users?sayfa=2" },
          { label: "9a1c0f10", title: "9a1c0f10-0001-4c00-8000-0000000000aa", mono: true },
        ]}
      />,
    );

    const nav = screen.getByRole("navigation", { name: "Konum" });
    expect(nav).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Kullanıcılar" })).toHaveAttribute(
      "href",
      "/users?sayfa=2",
    );
    const current = screen.getByText("9a1c0f10");
    expect(current.closest("[aria-current]")).toHaveAttribute("aria-current", "page");
    expect(current).toHaveAttribute("title", "9a1c0f10-0001-4c00-8000-0000000000aa");
    expect(current).toHaveClass("font-mono");
    expect(screen.queryByRole("link", { name: "9a1c0f10" })).not.toBeInTheDocument();
    // Ayraç süslemedir; ekran okuyucu okumaz.
    expect(nav.querySelector('[aria-hidden="true"]')?.textContent).toBe("›");
  });
});
