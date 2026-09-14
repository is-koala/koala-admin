"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { cn } from "@/lib/cn";
import {
  GLOBAL_SEARCH_DEBOUNCE_MS,
  GLOBAL_SEARCH_ENDPOINT,
  SEARCH_GROUP_LABELS,
  SEARCH_OBJECT_LABELS,
  isGlobalSearchResponse,
  type GlobalSearchResponse,
  type SearchHit,
} from "@/lib/global-search";

/**
 * Komut paleti — koala-admin#104. ⌘K / Ctrl+K ya da üst çubuktaki kutu
 * açar; bir UUID yapıştırılınca nesne doğrudan açılır, metin yazılınca
 * gruplu sonuç gelir ve ok tuşlarıyla gezilir.
 *
 * Tarayıcıdan yalnız `/api/search`'e gidilir; backend, token ve izin süzgeci
 * o ucun arkasında. Bu dosya bir Client Component ve `src/server/`'dan hiçbir
 * şey import etmez — `server-only` sınırı bunu derlemede zorlar.
 *
 * `<dialog showModal>` `ui/dialog.tsx` ile aynı gerekçeyle: odak tuzağı,
 * arka planın inertliği ve Escape tarayıcının işi. Odak dönüşünü yine de
 * kendimiz yapıyoruz: palet klavyeden, sayfanın herhangi bir yerinden
 * açılabilir ve odağın oraya — tetikleyiciye değil — dönmesi gerekir.
 *
 * Aynı anda tek istek: her arama bir sıra numarası alır ve öncekini iptal
 * eder; geç gelen eski cevap ekrana yazılmaz. 429'da palet `retryAfterMs`
 * boyunca yeni istek atmaz — backend'in kovasını boşuna doldurmak, sınırı
 * uzatmaktan başka bir şey yapmaz.
 */

type PaletteState =
  | { readonly phase: "idle" }
  | { readonly phase: "loading" }
  | { readonly phase: "done"; readonly response: GlobalSearchResponse }
  /** `/api/search` cevap vermedi ya da oturum düşüp giriş sayfasına yönlendi. */
  | { readonly phase: "failed"; readonly reason: "session" | "network" }
  | { readonly phase: "cooldown"; readonly until: number };

interface FlatOption {
  readonly id: string;
  readonly hit: SearchHit;
}

/**
 * Kısayol etiketi platforma göre; SSR "⌘K" basar, istemci hidrasyondan sonra
 * kendi platformunu yazar. Abone olunacak bir şey yok — değer değişmez.
 */
const noopSubscribe = () => () => undefined;
function shortcutForPlatform(): string {
  return /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl+K";
}

function isModifierK(event: KeyboardEvent): boolean {
  return (event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === "k";
}

export function CommandPalette() {
  const router = useRouter();
  /**
   * Yönlendirici ref'te: `navigate` ve ondan türeyen `runSearch` kimliğini
   * korusun. Aksi hâlde her render arama efektini yeniden kurar ve gelen
   * cevap yeni bir istek doğururdu.
   */
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const requestSeq = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** 429 sonrası yeni isteğin atılabileceği en erken an (epoch ms). */
  const cooldownUntil = useRef(0);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [state, setState] = useState<PaletteState>({ phase: "idle" });
  const [activeIndex, setActiveIndex] = useState(0);
  const shortcut = useSyncExternalStore(noopSubscribe, shortcutForPlatform, () => "⌘K");
  /** Soğuma bitince arama efektini yeniden uyandıran sayaç. */
  const [retryTick, setRetryTick] = useState(0);

  const baseId = useId();
  const listboxId = `${baseId}-listbox`;
  const titleId = `${baseId}-title`;
  const statusId = `${baseId}-status`;

  const openPalette = useCallback(() => {
    openerRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setOpen(true);
  }, []);

  const closePalette = useCallback(() => {
    abortRef.current?.abort();
    setOpen(false);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!isModifierK(event)) return;
      event.preventDefault();
      if (open) closePalette();
      else openPalette();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, openPalette, closePalette]);

  useEffect(() => {
    const element = dialogRef.current;
    if (element === null) return;
    if (open && !element.open) {
      element.showModal();
      inputRef.current?.focus();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  /** `close` hem Escape'ten hem `closePalette`'ten gelir; odak burada döner. */
  const onDialogClose = useCallback(() => {
    setOpen(false);
    setQuery("");
    setState({ phase: "idle" });
    setActiveIndex(0);
    const opener = openerRef.current;
    openerRef.current = null;
    (opener ?? triggerRef.current)?.focus();
  }, []);

  const navigate = useCallback(
    (href: string) => {
      closePalette();
      routerRef.current.push(href as Route);
    },
    [closePalette],
  );

  const runSearch = useCallback(
    async (value: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      const seq = ++requestSeq.current;

      setState({ phase: "loading" });
      let next: PaletteState;
      try {
        const response = await fetch(`${GLOBAL_SEARCH_ENDPOINT}?q=${encodeURIComponent(value)}`, {
          signal: controller.signal,
          credentials: "same-origin",
          cache: "no-store",
        });
        /**
         * Oturum düşünce `proxy.ts` `/giris`'e yönlendirir ve fetch onu izler:
         * 200 ve HTML gelir. JSON olmayan bir cevap, "arama bozuk" değil
         * "oturum yok" demektir; iki cümle birbirinin yerine geçmez.
         */
        const isJson = response.headers.get("content-type")?.includes("application/json") ?? false;
        if (response.redirected || response.status === 401 || !isJson) {
          next = { phase: "failed", reason: "session" };
        } else {
          const body: unknown = await response.json();
          if (!isGlobalSearchResponse(body)) {
            next = { phase: "failed", reason: "network" };
          } else if (body.kind === "rate-limited") {
            const until = Date.now() + body.retryAfterMs;
            cooldownUntil.current = until;
            window.setTimeout(() => setRetryTick((tick) => tick + 1), body.retryAfterMs);
            next = { phase: "cooldown", until };
          } else {
            next = { phase: "done", response: body };
          }
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        next = { phase: "failed", reason: "network" };
      }
      if (seq !== requestSeq.current) return;
      setState(next);
      setActiveIndex(0);
      // UUID bir nesneye denk geldiyse operatörün bir tuşa daha basması gerekmez.
      if (next.phase === "done" && next.response.kind === "object") {
        navigate(next.response.href);
      }
    },
    [navigate],
  );

  function onQueryChange(value: string) {
    setQuery(value);
    if (value.trim().length === 0) {
      // Boş kutu bekleyen isteği de ekrandaki cevabı da geçersiz kılar.
      abortRef.current?.abort();
      requestSeq.current += 1;
      setState({ phase: "idle" });
      setActiveIndex(0);
    }
  }

  useEffect(() => {
    if (!open) return;
    const trimmed = query.trim();
    if (trimmed.length === 0) return;
    // Soğuma süresi debounce'un üstüne değil yerine geçer: hangisi geçse o.
    const delay = Math.max(GLOBAL_SEARCH_DEBOUNCE_MS, cooldownUntil.current - Date.now());
    const timer = window.setTimeout(() => void runSearch(trimmed), delay);
    return () => window.clearTimeout(timer);
  }, [open, query, runSearch, retryTick]);

  const options = useMemo<readonly FlatOption[]>(() => {
    if (state.phase !== "done" || state.response.kind !== "groups") return [];
    return state.response.groups.flatMap((group) =>
      group.hits.map((hit) => ({ id: `${baseId}-${group.kind}-${hit.id}`, hit })),
    );
  }, [state, baseId]);

  useEffect(() => {
    if (options.length === 0) return;
    const element = document.getElementById(options[activeIndex]?.id ?? "");
    // jsdom `scrollIntoView` bilmez; tarayıcıda etkin satır görünür kalsın.
    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, options]);

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" && options.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + options.length) % options.length);
    } else if (event.key === "Home" && options.length > 0) {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End" && options.length > 0) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const active = options[activeIndex];
      if (active !== undefined) navigate(active.hit.href);
    } else if (event.key === "Escape") {
      // Tarayıcı `cancel` üretir; üretmeyen ortamlar için de kapat.
      event.preventDefault();
      closePalette();
    }
  }

  const activeOptionId = options[activeIndex]?.id;
  const expanded = options.length > 0;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openPalette}
        aria-haspopup="dialog"
        aria-keyshortcuts="Meta+K Control+K"
        className={cn(
          "flex h-8 items-center gap-2 rounded-full bg-white/10 px-3 text-sm text-on-brand/90",
          "hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white",
        )}
      >
        <SearchIcon />
        <span className="hidden sm:inline">Ara</span>
        <kbd className="hidden rounded border border-white/30 px-1 font-sans text-[11px] leading-4 text-on-brand/80 sm:inline">
          {shortcut}
        </kbd>
        <span className="sr-only">Panelde ara ({shortcut})</span>
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          closePalette();
        }}
        onClose={onDialogClose}
        className={cn(
          "m-auto mt-[10vh] w-full max-w-xl rounded-xl border border-border-subtle bg-surface p-0 text-ink shadow-xl",
          "backdrop:bg-ink/40",
        )}
      >
        <h2 id={titleId} className="sr-only">
          Panelde ara
        </h2>
        <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
          <SearchIcon className="text-ink-subtle" />
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-label="Ad, e-posta, ilan başlığı ya da kimlik (UUID)"
            aria-expanded={expanded}
            aria-controls={listboxId}
            aria-activedescendant={expanded ? activeOptionId : undefined}
            aria-autocomplete="list"
            aria-describedby={statusId}
            autoComplete="off"
            spellCheck={false}
            placeholder="Ad, e-posta, ilan başlığı ya da kimlik yapıştırın…"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={onInputKeyDown}
            className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            type="button"
            onClick={closePalette}
            className="rounded px-2 py-1 text-xs text-ink-muted hover:bg-surface-muted"
          >
            Esc
          </button>
        </div>

        <div className="max-h-[60vh] overflow-y-auto">
          <StatusLine id={statusId} state={state} query={query} />
          <div
            id={listboxId}
            role="listbox"
            aria-label="Arama sonuçları"
            className={cn("flex flex-col gap-2 p-2", expanded ? "" : "hidden")}
          >
            {state.phase === "done" && state.response.kind === "groups"
              ? state.response.groups
                  .filter((group) => group.hits.length > 0)
                  .map((group) => (
                    <div
                      key={group.kind}
                      role="group"
                      aria-labelledby={`${baseId}-group-${group.kind}`}
                    >
                      <div
                        id={`${baseId}-group-${group.kind}`}
                        className="flex items-baseline justify-between px-2 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-ink-muted"
                      >
                        <span>{SEARCH_GROUP_LABELS[group.kind]}</span>
                        {group.total > group.hits.length ? (
                          <span className="normal-case tracking-normal">
                            ilk {group.hits.length} / {group.total}
                          </span>
                        ) : null}
                      </div>
                      {group.hits.map((hit) => {
                        const id = `${baseId}-${group.kind}-${hit.id}`;
                        const active = id === activeOptionId;
                        return (
                          <div
                            key={hit.id}
                            id={id}
                            role="option"
                            aria-selected={active}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => navigate(hit.href)}
                            onMouseEnter={() =>
                              setActiveIndex(options.findIndex((option) => option.id === id))
                            }
                            className={cn(
                              "flex cursor-pointer flex-col gap-0.5 rounded-lg px-3 py-2",
                              active ? "bg-brand-soft text-ink" : "hover:bg-surface-muted",
                            )}
                          >
                            <span className="truncate text-sm font-medium">{hit.title}</span>
                            {hit.subtitle === null ? null : (
                              <span className="truncate text-xs text-ink-muted">
                                {hit.subtitle}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))
              : null}
          </div>
        </div>

        <div className="flex items-center gap-3 border-t border-border-subtle px-4 py-2 text-[11px] text-ink-subtle">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> gez
          </span>
          <span>
            <kbd>↵</kbd> aç
          </span>
          <span>
            <kbd>Esc</kbd> kapat
          </span>
        </div>
      </dialog>
    </>
  );
}

function StatusLine({ id, state, query }: { id: string; state: PaletteState; query: string }) {
  const text = statusText(state, query);
  return (
    <p
      id={id}
      role="status"
      aria-live="polite"
      className={cn("px-4 py-3 text-sm text-ink-muted", text === null ? "sr-only" : "")}
    >
      {text ?? ""}
    </p>
  );
}

function statusText(state: PaletteState, query: string): string | null {
  switch (state.phase) {
    case "idle":
      return query.trim().length === 0
        ? "Ad, e-posta ya da ilan başlığı yazın; bir kimlik (UUID) yapıştırırsanız nesne doğrudan açılır."
        : null;
    case "loading":
      return "Aranıyor…";
    case "failed":
      return state.reason === "session"
        ? "Oturum doğrulanamadı; sayfayı yenileyip yeniden giriş yapın."
        : "Arama şu anda yapılamıyor; biraz sonra yeniden deneyin.";
    case "cooldown":
      return `Çok sık arama yapıldı; ${Math.max(1, Math.ceil((state.until - Date.now()) / 1000))} saniye sonra kendiliğinden yeniden denenecek.`;
    case "done":
      return doneText(state.response);
  }
}

function doneText(response: GlobalSearchResponse): string | null {
  switch (response.kind) {
    case "idle":
      return "En az 2 karakter yazın.";
    case "object":
      return `${SEARCH_OBJECT_LABELS[response.objectKind]} açılıyor…`;
    case "not-found":
      return `Bu kimlikle erişebildiğiniz bir kayıt bulunamadı (${response.probed
        .map((kind) => SEARCH_OBJECT_LABELS[kind].toLocaleLowerCase("tr"))
        .join(", ")}).`;
    case "no-permission":
      return "Arayabileceğiniz bir kayıt türü için izniniz yok.";
    case "unavailable":
      return "Backend cevap vermedi; biraz sonra yeniden deneyin.";
    case "rate-limited":
      return "Çok sık arama yapıldı; biraz bekleyin.";
    case "groups": {
      const total = response.groups.reduce((sum, group) => sum + group.hits.length, 0);
      const failed = response.failures.map((failure) =>
        SEARCH_GROUP_LABELS[failure.kind].toLocaleLowerCase("tr"),
      );
      const tooLong = response.failures.some((failure) => failure.reason === "too-long");
      const parts: string[] = [];
      if (total === 0) parts.push(`“${response.query}” için sonuç yok.`);
      else parts.push(`${total} sonuç.`);
      if (tooLong) parts.push("Arama metni en fazla 100 karakter olabilir.");
      else if (failed.length > 0) parts.push(`Cevap vermeyen gruplar: ${failed.join(", ")}.`);
      return parts.join(" ");
    }
  }
}

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.75" />
      <path d="M16 16l4 4" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
    </svg>
  );
}
