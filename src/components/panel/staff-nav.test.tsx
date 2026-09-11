import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { navigationFor } from "@/server/authz/routes";

import { StaffNav } from "./staff-nav";

/**
 * The menu's drawing rules, at the component seam.
 *
 * `routes.test.ts` already proves which hrefs a permission list produces.
 * This file proves the chrome around those hrefs: group headings appear for
 * the screens that were handed in, empty groups stay gone, and the link
 * order is still the registry's order — grouping is a heading, not a sort.
 */

describe("StaffNav groups the screens it was handed", () => {
  it("names the group of a single screen and does not invent the others", () => {
    render(<StaffNav entries={navigationFor(["category.manage"])} />);

    expect(screen.getByRole("link", { name: "İş kategorileri" })).toHaveAttribute(
      "href",
      "/job-categories",
    );
    expect(screen.getByText("Katalog")).toBeInTheDocument();
    expect(screen.queryByText("Operasyon")).not.toBeInTheDocument();
    expect(screen.queryByText("Finans")).not.toBeInTheDocument();
    expect(screen.queryByText("Yönetim")).not.toBeInTheDocument();
  });

  it("keeps registry order when several groups appear", () => {
    render(<StaffNav entries={navigationFor(["category.manage", "audit.read", "finance.read"])} />);

    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/job-categories",
      "/finance",
      "/audit-log",
    ]);
    expect(screen.getByText("Katalog")).toBeInTheDocument();
    expect(screen.getByText("Finans")).toBeInTheDocument();
    expect(screen.getByText("Yönetim")).toBeInTheDocument();
  });

  it("explains an empty menu without drawing group headings", () => {
    render(<StaffNav entries={[]} />);

    expect(screen.getByTestId("staff-nav-empty")).toHaveTextContent(
      "Erişebileceğiniz bir ekran yok.",
    );
    expect(screen.queryByText("Katalog")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("keeps the unresolved empty copy, still without groups", () => {
    render(<StaffNav entries={[]} unresolved />);

    expect(screen.getByTestId("staff-nav-empty")).toHaveTextContent(
      "İzinler çözülemedi, bu yüzden menü boş. Aşağıdaki açıklamaya bakın.",
    );
    expect(screen.queryByText("Katalog")).not.toBeInTheDocument();
  });
});
