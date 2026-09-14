import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { navigationFor } from "@/server/authz/routes";

import { PanelShell } from "./panel-shell";

const pathname = vi.hoisted(() => ({ current: "/identity-reviews" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathname.current,
  // Üst çubuktaki komut paleti (#104) yönlendirici ister; burada gezinilmez.
  useRouter: () => ({ push: () => undefined }),
}));

/**
 * The merchant-panel chrome: branded top bar, icon sidebar, content canvas.
 *
 * Identity reviews must stay in the operations group — koala-admin#57 is a
 * real queue, not a restyle casualty. The shell draws what it is handed; it
 * does not invent permissions.
 */

const signOut = async () => undefined;

describe("PanelShell", () => {
  it("puts the operator and the theme switch on the branded top bar", () => {
    render(
      <PanelShell
        staff={{ displayName: "Yusuf Açmacı", email: "yusuf@iskoala.com" }}
        entries={[]}
        signOut={signOut}
      >
        <p>Sayfa</p>
      </PanelShell>,
    );

    expect(screen.getByRole("banner")).toHaveTextContent("koala");
    expect(screen.getByRole("banner")).toHaveTextContent("Yusuf Açmacı");
    expect(screen.getByRole("button", { name: "Koyu temaya geç" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Çıkış yap" })).toBeInTheDocument();
  });

  it("keeps identity reviews in the sidebar and marks the current screen", () => {
    render(
      <PanelShell
        staff={{ displayName: "Yusuf Açmacı", email: "yusuf@iskoala.com" }}
        entries={navigationFor(["identity.review"])}
        signOut={signOut}
      >
        <p>Kuyruk</p>
      </PanelShell>,
    );

    const review = screen.getByRole("link", { name: "Kimlik incelemeleri" });
    expect(review).toHaveAttribute("href", "/identity-reviews");
    expect(review).toHaveAttribute("aria-current", "page");
    expect(screen.getByText("Operasyon")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Güncel durum" })).toHaveAttribute("href", "/");
  });

  it("keeps the section lit on an object page, where the shared boundaries also render", () => {
    pathname.current = "/identity-reviews/a1000000-0000-4000-8000-000000000001";
    try {
      render(
        <PanelShell
          staff={{ displayName: "Yusuf Açmacı", email: "yusuf@iskoala.com" }}
          entries={navigationFor(["identity.review"])}
          signOut={signOut}
        >
          <p>Nesne</p>
        </PanelShell>,
      );

      expect(screen.getByRole("link", { name: "Kimlik incelemeleri" })).toHaveAttribute(
        "aria-current",
        "true",
      );
      expect(screen.getByRole("link", { name: "Güncel durum" })).not.toHaveAttribute(
        "aria-current",
      );
    } finally {
      pathname.current = "/identity-reviews";
    }
  });
});
