export type Theme = "light" | "dark";

/** Tercih çerezi — bootstrap script okur, asla HttpOnly değil. */
export const THEME_COOKIE = "koala_admin_theme";

const MAX_AGE_SECONDS = 31536000;

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

export function toggleTheme(theme: Theme): Theme {
  return theme === "dark" ? "light" : "dark";
}

export function themeCookie(theme: Theme): string {
  return `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${MAX_AGE_SECONDS}; SameSite=Lax`;
}

/**
 * `<head>` içinde çalışır ki ilk boya kayıtlı paletle gelsin.
 * Çerez kazanır; silinmişse localStorage yedek.
 */
export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(THEME_COOKIE)};var t="";var m=document.cookie.match(new RegExp("(?:^|; )"+k+"=(light|dark)"));if(m)t=m[1];if(!t)t=localStorage.getItem(k)||"";if(t!=="dark")t="light";var r=document.documentElement;r.dataset.theme=t;r.style.colorScheme=t;r.classList.remove("light","dark");r.classList.add(t);}catch(e){}})();`;

export function applyTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  root.classList.remove("light", "dark");
  root.classList.add(theme);
}

export function persistTheme(theme: Theme, root: HTMLElement = document.documentElement): void {
  applyTheme(theme, root);
  document.cookie = themeCookie(theme);
  try {
    window.localStorage.setItem(THEME_COOKIE, theme);
  } catch {
    // Gizli mod localStorage reddedebilir; bir sonraki istek için çerez yeter.
  }
}
