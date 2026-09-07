import { describe, expect, it } from "vitest";

import { renderServerComponent } from "../../../../test/render-server";

import { AUTH_FAILURE_CODES, type AuthFailureCode } from "@/server/auth/errors";

import SignInErrorPage from "./page";

/**
 * Bu sayfanın işi tek bir şey: aynı olayı **farklı** anlatmak.
 *
 * `src/proxy.ts` ve `require-permission.tsx` buraya bir kod gönderiyor; kodun
 * ne işe yaradığı, karşılığındaki cümlelerin birbirinin yerine geçmemesine
 * bağlı. Geçtiği anda kod bir süslemeye dönüşür: hepsi "giriş yapılamadı" diyen
 * bir panel, backend düştüğünde insanı parolasını sorgulamaya, oturumu bittiğinde
 * ise sunucu odasına gönderir.
 *
 * Buradaki en önemli iddia `SESSION_EXPIRED` ile `BACKEND_UNREACHABLE`
 * arasındaki. Bu ikisi tel üzerinde tek bir olaydan doğuyor — yenileme
 * başarısız oldu — ve ekranda taban tabana zıt iki şey söylemek zorundalar.
 * `proxy.test.ts` proxy'nin doğru kodu gönderdiğini ölçüyor; burada ölçülen,
 * kodun gerçekten farklı bir ekrana açıldığı.
 *
 * `EXPLANATIONS` tip düzeyinde `Record<AuthFailureCode, …>` olduğu için "her
 * kodun bir karşılığı var" derleyicinin işi; testin işi karşılıkların
 * **birbirinden ayrı** olduğu.
 */

function render(code: string): Promise<string> {
  return renderServerComponent(<SignInErrorPage searchParams={Promise.resolve({ kod: code })} />);
}

/**
 * `BACKEND_UNREACHABLE` ekranının, yalnız ona ait olması gereken iki cümlesi.
 *
 * Kesme işareti HTML'de kaçırılıyor (`backend&#x27;inin`), bu yüzden ikinci
 * parça onun bir yanından başlıyor — `gate.test.tsx`'te aynı düzen var.
 */
const BLAMES_THE_BACKEND = [
  "Yetkinizle ya da hesabınızla ilgili bir sorun değil",
  "inin ayakta olduğunu doğrulayın",
];

describe("a rejected refresh and an unreachable backend do not share a screen", () => {
  it("tells someone whose session ended to sign in again, and nothing about servers", async () => {
    // Oturumu bitiren üç yol da olağan: çıkış, kendi parolasını değiştirmek, ve
    // bir yöneticinin parolayı sıfırlaması. Üçünde de sistem beklendiği gibi
    // çalışıyor, ve kişiye söylenecek şey tek bir cümle.
    const html = await render("SESSION_EXPIRED");

    expect(html).toContain("Oturumunuz sona erdi");
    expect(html).toContain("Yeniden giriş yapın.");

    for (const sentence of BLAMES_THE_BACKEND) {
      expect(html, sentence).not.toContain(sentence);
    }
  });

  it("tells someone facing a silent backend that it is not about them", async () => {
    const html = await render("BACKEND_UNREACHABLE");

    expect(html).toContain("Koala&#x27;ya ulaşılamıyor");
    for (const sentence of BLAMES_THE_BACKEND) {
      expect(html, sentence).toContain(sentence);
    }

    // Ve tersi de doğru olmalı: burada "oturumunuz bitti" demek, ayakta bir
    // hesabı olan kişiyi yeniden giriş yapmaya çalışıp yine başaramamaya
    // gönderirdi.
    expect(html).not.toContain("Oturumunuz sona erdi");
  });

  it("gives the password-change flag the screen that fixes it rather than one that explains it", async () => {
    const html = await render("PASSWORD_CHANGE_REQUIRED");

    expect(html).toContain("Parola değiştirme ekranına git");
    expect(html).toContain("/giris/parola");
    // Yetki eksikliği DEĞİL: OWNER'a "izniniz yok" demek onu rol aramaya
    // gönderirdi.
    expect(html).not.toContain("yetkiniz yok");
  });
});

describe("every code the panel can send has its own words", () => {
  it("gives no two codes the same title", async () => {
    const titles = await Promise.all(
      AUTH_FAILURE_CODES.map(async (code: AuthFailureCode) => {
        const html = await render(code);
        // Başlık `ErrorState`'in ilk `<p>`'si; kodun kendisi de sayfada, ama
        // kimseye bir şey anlatan o değil.
        return html.slice(0, html.indexOf(code));
      }),
    );

    expect(new Set(titles).size).toBe(AUTH_FAILURE_CODES.length);
  });

  it("falls back to the unknown screen for a code nobody defined", async () => {
    // `?kod=` kullanıcı girdisi. Tanınmayan bir değerin boş bir sayfaya ya da
    // bir çökmeye dönüşmemesi gerekiyor.
    const html = await render("IDP_UNREACHABLE");

    expect(html).toContain("Giriş tamamlanamadı");
    expect(html).not.toContain("IDP_UNREACHABLE");
  });
});
