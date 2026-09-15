import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import { THEME_COOKIE } from "@/lib/theme";

import { ThemeToggle } from "./theme-toggle";

/**
 * The theme switch the operator actually presses.
 *
 * Persistence is the cookie the bootstrap script reads on the next load, plus
 * `data-theme` on the root so the current page flips immediately. The label
 * must say which palette the click will produce, not the one already showing.
 */

afterEach(() => {
  document.cookie = `${THEME_COOKIE}=; Path=/; Max-Age=0`;
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.style.colorScheme = "";
  document.documentElement.classList.remove("light", "dark");
  window.localStorage.clear();
});

describe("ThemeToggle", () => {
  it("starts in light and names the dark target", () => {
    render(<ThemeToggle />);

    expect(screen.getByRole("button", { name: "Koyu temaya geç" })).toBeInTheDocument();
    expect(document.documentElement.dataset.theme).toBeUndefined();
  });

  it("persists dark on the root, in the cookie, and in localStorage", async () => {
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Koyu temaya geç" }));

    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.style.colorScheme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(document.cookie).toContain(`${THEME_COOKIE}=dark`);
    expect(window.localStorage.getItem(THEME_COOKIE)).toBe("dark");
    expect(screen.getByRole("button", { name: "Açık temaya geç" })).toBeInTheDocument();
  });

  it("returns to light on a second click", async () => {
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: "Koyu temaya geç" }));
    await userEvent.click(screen.getByRole("button", { name: "Açık temaya geç" }));

    expect(document.documentElement.dataset.theme).toBe("light");
    expect(document.cookie).toContain(`${THEME_COOKIE}=light`);
    expect(window.localStorage.getItem(THEME_COOKIE)).toBe("light");
  });
});
