/** @vitest-environment jsdom */

import { describe, expect, it } from "vitest";

import {
  THEME_BOOTSTRAP_SCRIPT,
  THEME_COOKIE,
  applyTheme,
  parseTheme,
  themeCookie,
  toggleTheme,
} from "./theme";

/**
 * Theme preference at the cookie/document seam.
 *
 * The operator's light/dark choice has to survive a reload without a flash of
 * the wrong palette, and it must default to light — the merchant-panel look
 * the chrome is built around. Expected values are the literals the browser
 * will see, not a recomputation of the helper.
 */

describe("parseTheme", () => {
  it("defaults to light when the cookie is missing or unknown", () => {
    expect(parseTheme(undefined)).toBe("light");
    expect(parseTheme(null)).toBe("light");
    expect(parseTheme("")).toBe("light");
    expect(parseTheme("system")).toBe("light");
  });

  it("accepts only the two stored values", () => {
    expect(parseTheme("light")).toBe("light");
    expect(parseTheme("dark")).toBe("dark");
  });
});

describe("toggleTheme", () => {
  it("flips the two palettes", () => {
    expect(toggleTheme("light")).toBe("dark");
    expect(toggleTheme("dark")).toBe("light");
  });
});

describe("themeCookie", () => {
  it("writes a year-long Lax cookie the client can read", () => {
    expect(themeCookie("dark")).toBe(
      `${THEME_COOKIE}=dark; Path=/; Max-Age=31536000; SameSite=Lax`,
    );
  });
});

describe("THEME_BOOTSTRAP_SCRIPT", () => {
  it("applies the cookie to the document before paint", () => {
    expect(THEME_BOOTSTRAP_SCRIPT).toContain(THEME_COOKIE);
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("dataset.theme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("colorScheme");
    expect(THEME_BOOTSTRAP_SCRIPT).toContain("classList");
  });
});

describe("applyTheme", () => {
  it("sets the matching html class so HeroUI follows the same palette", () => {
    const root = document.createElement("html");
    root.classList.add("light");

    applyTheme("dark", root);

    expect(root.dataset.theme).toBe("dark");
    expect(root.style.colorScheme).toBe("dark");
    expect(root.classList.contains("dark")).toBe(true);
    expect(root.classList.contains("light")).toBe(false);
  });
});
