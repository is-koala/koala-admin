import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import PanelError from "./error";
import PanelLoading from "./loading";
import PanelNotFound from "./not-found";

/**
 * koala-admin#85: panelin paylaştığı üç rota sınırı.
 *
 * Üçü de `src/app/(panel)/` altında, çünkü kabuğun *içinde* çizilmeliler:
 * menü, çıkış ve tema anahtarı yerinde dururken sayfa alanı "yükleniyor",
 * "bozuk" ya da "yok" der. Kök seviyede bir kopya kabuğu düşürürdü; bölüm
 * başına `error`/`not-found` ise yalnız bunu tekrar ederdi.
 *
 * `loading` istisna; son grup gerekçesini sabitler. Kuyruk ile nesne sayfası
 * (`/reports` ve `/reports/[id]`) aynı segmentin iki çocuğu ve `(panel)`
 * seviyesindeki Suspense ikisi arasında geçilirken zaten ekranda — React
 * çizilmiş bir sınırı yeniden askıya almaz, eski sayfayı tutar. Tarayıcıda
 * görüldü: nesne sayfasından "Kuyruğa dön" kuyruk gelene dek nesneyi
 * gösterdi. `[id]` klasörünün yanındaki `loading.tsx` sınırı değişen çocuğun
 * etrafına koyar.
 *
 * Ağırlığı taşıyan iddia hata grubundaki sonuncusu. Next `error.tsx`'e
 * fırlatılan nesnenin kendisini verir ve geliştirmede o nesne orijinal
 * mesajı taşır; bir `KoalaApiError` mesajı upstream çağrının yolunu,
 * metodunu ve durum kodunu içerir. Çizilseydi hatayı gören kişinin ekranına
 * inerdi. Sınır onun yerine digest'i gösterir: sunucu günlüğünde aranabilen
 * tek şey o.
 */

describe("the shared loading view", () => {
  it("announces itself as a status with Turkish text a screen reader can read", () => {
    const { container } = render(<PanelLoading />);

    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("Sayfa yükleniyor");

    // `aria-busy` yükleniyor cümlesinin üstünde olamaz: yardımcı teknoloji
    // meşgul bir canlı bölgenin içeriğini erteleyebilir ve duyurulması
    // istenen tek cümle yutulurdu. Meşgul olan iskelet; durum onun kardeşi.
    expect(status).not.toHaveAttribute("aria-busy");
    const busy = container.querySelector('[aria-busy="true"]');
    expect(busy).not.toBeNull();
    expect(busy).not.toContainElement(status);
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
    // Alert değil: bozuk bir şey yok, adres yalnızca hiçbir kaydı adreslemiyor.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("sections with an object page carry the loading boundary themselves", () => {
  // `fileURLToPath(new URL(".", import.meta.url))` kardeş testlerin kalıbı, ama
  // `dom` projesinde Vite o `new URL(…, import.meta.url)` biçimini varlık
  // adresine çevirip şemayı bozuyor. Düz dizeden çözmek yüzde-kodlamayı yine
  // açar (boşluk, Türkçe harf) ve yeniden yazımdan kaçar.
  const PANEL_DIR = path.dirname(fileURLToPath(import.meta.url));

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
      const loaded = (await import(`./${section}/loading.tsx`)) as { default: unknown };
      expect(loaded.default, `${section}/loading.tsx must re-export (panel)/loading.tsx`).toBe(
        PanelLoading,
      );
    }
  });
});
