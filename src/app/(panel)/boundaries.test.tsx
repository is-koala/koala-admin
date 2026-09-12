import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import PanelError from "./error";
import PanelLoading from "./loading";
import PanelNotFound from "./not-found";

/**
 * koala-admin#85: the three route boundaries the panel shares.
 *
 * All three sit at `src/app/(panel)/` so they render *inside* the shell — the
 * menu, the sign-out button and the theme switch stay where they are while
 * the page area says "loading", "broken" or "gone". A root-level copy would
 * drop the chrome; a per-section `error`/`not-found` would only repeat this.
 *
 * `loading` is the exception, and the last group below pins why. A queue and
 * its object page (`/reports` and `/reports/[id]`) are two children of one
 * segment, and the `(panel)` Suspense above them is already on screen when
 * the operator moves between them — React keeps the old page up rather than
 * re-suspending a mounted boundary. Seen in the browser: "Kuyruğa dön" from
 * an object page showed the object until the queue arrived. A `loading.tsx`
 * beside the `[id]` folder puts the boundary around the child that changes.
 *
 * The claim that carries weight is the last one in the error group: Next hands
 * `error.tsx` the thrown object, and in development that object still carries
 * the original message. A backend `KoalaApiError` message can name the path,
 * the method and the status of an upstream call. Rendering it would put that on
 * the screen of whoever hit the bug; the boundary shows the digest instead,
 * which is what a server log can be searched for.
 */

describe("the shared loading view", () => {
  it("announces itself as a busy status with Turkish text a screen reader can read", () => {
    render(<PanelLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-busy", "true");
    expect(status).toHaveTextContent("Sayfa yükleniyor");
  });
});

describe("the unexpected-error boundary", () => {
  it("explains in Turkish, retries through Next, and offers the panel home as the way back", async () => {
    const retry = vi.fn();
    render(<PanelError error={new Error("boom")} retry={retry} reset={vi.fn()} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Beklenmeyen bir hata oluştu" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Tekrar dene" }));
    expect(retry).toHaveBeenCalledTimes(1);

    expect(screen.getByRole("link", { name: "Güncel duruma dön" })).toHaveAttribute("href", "/");
  });

  it("shows the digest so the failure can be found in the server log", () => {
    const error = Object.assign(new Error("x"), { digest: "1234567890" });
    render(<PanelError error={error} retry={vi.fn()} reset={vi.fn()} />);

    expect(screen.getByText("1234567890")).toBeInTheDocument();
    expect(screen.getByText(/Hata imzası/)).toBeInTheDocument();
  });

  it("never renders the thrown message, which may describe an upstream call", () => {
    const secret =
      "Koala API isteği başarısız oldu (GET /admin/reports/abc, HTTP 500). Bearer ACCESS-TOKEN";
    render(<PanelError error={new Error(secret)} retry={vi.fn()} reset={vi.fn()} />);

    expect(document.body.textContent).not.toContain("Koala API isteği");
    expect(document.body.textContent).not.toContain("/admin/reports/abc");
    expect(document.body.textContent).not.toContain("ACCESS-TOKEN");
    expect(screen.queryByText(/Hata imzası/)).not.toBeInTheDocument();
  });
});

describe("the not-found surface", () => {
  it("says the record is gone in Turkish and links back to the panel home", () => {
    render(<PanelNotFound />);

    expect(screen.getByRole("heading", { level: 1, name: "Kayıt bulunamadı" })).toBeInTheDocument();
    expect(screen.getByText(/404/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Güncel duruma dön" })).toHaveAttribute("href", "/");
    // Not an alert: nothing is broken, the address simply names nothing.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("sections with an object page carry the loading boundary themselves", () => {
  const PANEL_DIR = path.dirname(new URL(import.meta.url).pathname);

  async function sectionsWithObjectPages(): Promise<string[]> {
    const sections: string[] = [];
    for (const entry of await readdir(PANEL_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const objectPage = path.join(PANEL_DIR, entry.name, "[id]", "page.tsx");
      const exists = await stat(objectPage).then(
        () => true,
        () => false,
      );
      if (exists) sections.push(entry.name);
    }
    return sections.sort();
  }

  it("finds the sections this slice ships, so an empty scan cannot pass", async () => {
    expect(await sectionsWithObjectPages()).toEqual(
      expect.arrayContaining(["reports", "companies", "users"]),
    );
  });

  it("re-exports the shared view next to every [id] folder, and adds no second design", async () => {
    for (const section of await sectionsWithObjectPages()) {
      const loaded = (await import(`./${section}/loading`)) as { default: unknown };
      expect(loaded.default, `${section}/loading.tsx must re-export (panel)/loading.tsx`).toBe(
        PanelLoading,
      );
    }
  });
});
