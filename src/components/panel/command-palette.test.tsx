import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GlobalSearchResponse } from "@/lib/global-search";

import { CommandPalette } from "./command-palette";

const push = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

/**
 * Komut paleti (koala-admin#104): kısayol, debounce, gruplu sonuç, klavye
 * gezintisi ve odak dönüşü. Ağ yok — `fetch` sahte; palet zaten yalnız
 * `/api/search`'e gider ve bu test o çağrının **ne zaman** ve **neyle**
 * yapıldığını ölçer.
 */

const UUID = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

function jsonResponse(body: GlobalSearchResponse, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const groups: GlobalSearchResponse = {
  kind: "groups",
  query: "ayşe",
  groups: [
    {
      kind: "user",
      total: 12,
      hits: [
        { id: "u-1", href: "/users/u-1", title: "Ayşe Yılmaz", subtitle: "@ayse" },
        { id: "u-2", href: "/users/u-2", title: "Ayşe Kaya", subtitle: null },
      ],
    },
    { kind: "job", total: 0, hits: [] },
    {
      kind: "assignment",
      total: 1,
      hits: [
        {
          id: "a-1",
          href: "/assignments/a-1",
          title: "Garsonluk",
          subtitle: "Tamamlandı · Ayşe Yılmaz",
        },
      ],
    },
  ],
  failures: [],
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  // jsdom native dialog'un üst katmanını bilmez; `ui/dialog.tsx` testiyle aynı yama.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute("open");
    this.dispatchEvent(new Event("close"));
  };
});

afterEach(() => {
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  push.mockReset();
});

function renderPalette() {
  render(
    <>
      <button type="button">Başka bir şey</button>
      <CommandPalette />
    </>,
  );
}

async function openWithShortcut(user: ReturnType<typeof userEvent.setup>) {
  await user.keyboard("{Meta>}k{/Meta}");
  return screen.getByRole("dialog");
}

describe("CommandPalette", () => {
  it("opens from the top-bar trigger and from ⌘K / Ctrl+K, as an accessible dialog", async () => {
    const user = userEvent.setup();
    renderPalette();

    const trigger = screen.getByRole("button", { name: /Panelde ara/ });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();

    await user.click(trigger);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAccessibleName("Panelde ara");
    const input = within(dialog).getByRole("combobox");
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute("aria-expanded", "false");

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(trigger).toHaveFocus();

    await user.keyboard("{Control>}k{/Control}");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("returns focus to wherever the shortcut was pressed, not to the trigger", async () => {
    const user = userEvent.setup();
    renderPalette();
    const elsewhere = screen.getByRole("button", { name: "Başka bir şey" });
    elsewhere.focus();

    await openWithShortcut(user);
    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(elsewhere).toHaveFocus();
  });

  it("debounces typing into one request for the final text", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(groups));
    renderPalette();
    await openWithShortcut(user);

    await user.keyboard("ayşe");

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).toBe(`/api/search?q=${encodeURIComponent("ayşe")}`);
    expect((init as RequestInit).signal).toBeInstanceOf(AbortSignal);
    // Debounce'tan sonra da ikinci bir istek doğmamalı.
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders grouped options, walks them with the arrow keys and opens the active one on Enter", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(groups));
    renderPalette();
    const dialog = await openWithShortcut(user);
    const input = within(dialog).getByRole("combobox");

    await user.keyboard("ayşe");
    await within(dialog).findAllByRole("option");
    const listbox = within(dialog).getByRole("listbox");

    const groupsDrawn = within(listbox).getAllByRole("group");
    expect(groupsDrawn.map((group) => group.getAttribute("aria-labelledby"))).toHaveLength(2);
    expect(within(listbox).getByText("Kullanıcılar")).toBeInTheDocument();
    expect(within(listbox).getByText("Atamalar")).toBeInTheDocument();
    expect(within(listbox).queryByText("İlanlar")).not.toBeInTheDocument();
    expect(within(listbox).getByText("ilk 2 / 12")).toBeInTheDocument();

    const options = within(listbox).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Ayşe Yılmaz@ayse",
      "Ayşe Kaya",
      "GarsonlukTamamlandı · Ayşe Yılmaz",
    ]);
    expect(input).toHaveAttribute("aria-expanded", "true");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    expect(options[0]).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("status")).toHaveTextContent("3 sonuç.");

    await user.keyboard("{ArrowDown}{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2]?.id);
    expect(options[2]).toHaveAttribute("aria-selected", "true");
    // Sonuncudan sonra başa sarar; yukarı ok geri gelir.
    await user.keyboard("{ArrowDown}");
    expect(input).toHaveAttribute("aria-activedescendant", options[0]?.id);
    await user.keyboard("{ArrowUp}");
    expect(input).toHaveAttribute("aria-activedescendant", options[2]?.id);

    await user.keyboard("{Enter}");
    expect(push).toHaveBeenCalledWith("/assignments/a-1");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("opens an option on click too", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(groups));
    renderPalette();
    const dialog = await openWithShortcut(user);

    await user.keyboard("ayşe");
    await user.click(await within(dialog).findByRole("option", { name: /Ayşe Kaya/ }));

    expect(push).toHaveBeenCalledWith("/users/u-2");
  });

  it("opens the object straight away when a UUID resolves", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse({
        kind: "object",
        objectKind: "payout",
        href: `/payout-reconciliation/${UUID}`,
      }),
    );
    renderPalette();
    await openWithShortcut(user);

    await user.paste(UUID);

    await waitFor(() => expect(push).toHaveBeenCalledWith(`/payout-reconciliation/${UUID}`));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("says a UUID was not found, naming the kinds that were probed, and offers nothing to open", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ kind: "not-found", probed: ["user", "dispute"] }));
    renderPalette();
    const dialog = await openWithShortcut(user);

    await user.paste(UUID);

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Bu kimlikle erişebildiğiniz bir kayıt bulunamadı (kullanıcı, uyuşmazlık).",
      ),
    );
    expect(within(dialog).getByRole("combobox")).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(push).not.toHaveBeenCalled();
  });

  it("tells a staff member with no searchable permission so, in Turkish", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ kind: "no-permission" }));
    renderPalette();
    await openWithShortcut(user);

    await user.keyboard("ayşe");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "Arayabileceğiniz bir kayıt türü için izniniz yok.",
      ),
    );
  });

  it("reports an empty text result and a group that did not answer", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse({
        kind: "groups",
        query: "zzz",
        groups: [{ kind: "user", total: 0, hits: [] }],
        failures: [{ kind: "assignment", reason: "upstream" }],
      }),
    );
    renderPalette();
    await openWithShortcut(user);

    await user.keyboard("zzz");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent(
        "“zzz” için sonuç yok. Cevap vermeyen gruplar: atamalar.",
      ),
    );
  });

  it("backs off after a 429 instead of sending more requests", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse({ kind: "rate-limited", retryAfterMs: 60_000 }, 429));
    renderPalette();
    await openWithShortcut(user);

    await user.keyboard("ayşe");
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Çok sık arama"));

    await user.keyboard(" yılmaz");
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reads a redirect to the sign-in page as a lost session, not a broken search", async () => {
    const user = userEvent.setup();
    const redirected = new Response("<html>giriş</html>", {
      status: 200,
      headers: { "content-type": "text/html" },
    });
    Object.defineProperty(redirected, "redirected", { value: true });
    fetchMock.mockResolvedValue(redirected);
    renderPalette();
    await openWithShortcut(user);

    await user.keyboard("ayşe");

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Oturum doğrulanamadı"),
    );
  });
});
