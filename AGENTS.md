<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# koala-admin — ajanlar için çalışma kuralları

Personel paneli, `admin.iskoala.com`. Kardeş depoların rehberini kopyalama:
her iddia bu deponun kodundan gelir.

**Bağlayıcı belge bu dosyadır.** `CONTRIBUTING.md` yalnız buraya işaret eder;
çelişirlerse burası kazanır. `CLAUDE.md` Next'in `@AGENTS.md` işaretçisidir,
ikinci bir kural seti değil.

## Neden üstteki Next.js bloğu duruyor (koala-admin#23)

Next 16.3.4 `pnpm dev` bir ajan görünce kökte `AGENTS.md` ve `CLAUDE.md`
yazıyor (`node_modules/next/dist/server/lib/generate-agent-files.js`). Üretilmiş
metin kendi commit edilmesini savunuyor; o talimat deponun kararı değil.

Bu repo **iki katman** kullanıyor, koala-web'in "bloğu sahiplen" kalıbı artı
Next'in resmi kapatma anahtarı:

1. `next.config.ts` içinde `agentRules: false`. `start-server.js` üretimi bu
   bayrağa bağlı (varsayılan `true`). Kapalıyken `pnpm dev` dosya yazmaz.
2. Üstteki `BEGIN:nextjs-agent-rules` bloğu **byte-eş**.
   `hasCurrentAgentRules()` onu görünce no-op. Bayrak bir gün geri açılırsa
   Next bu dosyayı silip kendi iskeletini koymaz; bloğu yerinde bırakır, #18
   metni durur.

`.gitignore`'a `AGENTS.md` eklenmez: ignore, rehberi ajanın bağlamından çıkarır.
Bloğu bir diff'ten silmek kirli bir overwrite davetidir; `src/agent-rules.test.ts`
üçünü de (bayrak, blok, işaretçi) sabitler.

## Dil

Kullanıcıya görünen her metin **Türkçe**. Kod içi tanımlayıcılar (değişken,
bileşen, tip, izin adları) İngilizce. Yorumlar Türkçe ve **neden**i anlatır,
ne yaptığını değil. Mevcut dosyalar bu kurala tam uymuyor; yeni yazılan uyacak.

## Paket yöneticisi

**pnpm**, npm değil. `package.json` `"packageManager": "pnpm@12.3.4"` diyor;
CI `pnpm/action-setup@v4` kullanıyor. `npm run` ve `npx` kardeş depolardan
alışkanlık — burada kilit dosyası `pnpm-lock.yaml`.

## Yetki (ADR-0014)

İzinler oturuma **gömülmez**. `StaffSession` (`src/server/auth/cookies.ts`)
yalnız token'ları, süreleri ve `mustChangePassword` bayrağını taşır. Rol ve
izin her istekte `GET /admin/me`'den okunur (`src/server/authz/me.ts`,
`cache: "no-store"`). Çereze izin listesi koymak ADR-0010'un çıkardığı
bayatlığı geri getirir; `src/server/auth/no-permissions-in-session.test.ts`
yokluğu sabitler.

Kapının **iki yarısı** var ve ikisi de yazılır:

- **Sayfa:** `<RequirePermission>` çocukları çizmez, yani sayfa fetch'i
  çalışmaz (`gate.test.tsx` istek sayısını sıfırlar). CSS gizleme değil.
  Server Action'ı korumaz: o, kendi URL'i olan bir POST ucudur.
- **Eylem:** `guardDecision` (kuyruk), `runEscrowOperation` (para),
  `runAuthorizationChange` (rol/personel). İzni `/admin/me`'den yeniden
  çözer. `server-actions.test.ts` her `"use server"` export'unun bunlardan
  birinden geçmesini ister.

İkisi birlikte. Yalnız görsel yarı, gizli bir `<div>`'in veriyi koruduğu
kadar korur. Otorite yine backend'deki `@RequiresPermission`.

## Oturum (ADR-0011)

Token `HttpOnly`, `SameSite=Lax` çerezde. Tarayıcı `api.iskoala.com` ile
doğrudan konuşmaz: `src/server/api/koala.ts` `import "server-only"` ile
başlar; `NEXT_PUBLIC_*` yok; `next.config.ts`'te `env` bloğu yok. Çerez
şifrelenmiyor — içeriği zaten backend'in imzaladığı bearer token.

## `mustChangePassword` tuzağı

Bayrak açıkken backend `/admin/**`'ın tamamını — `/admin/me` dâhil —
403'ler (`StaffPermissionAuthorizationManager`). Panelde izin çözülemez;
bunu "personel kaydı yok" sanmak yanlış teşhis. Tek çıkış `/giris/parola`
(`src/proxy.ts` her başka yolu oraya götürür; `routes.ts` bu sayfayı
bilerek izinsiz bırakır). Bayrağı çerezden `false` yazmak yetmez: 403
yine gelir, `staff-context.ts` hangisi olduğunu backend'e sorar.

## `ADMIN_PUBLIC_ORIGIN`

Çerezin `Secure` işaretini ve adını bu belirler
(`buildSessionCookie`: origin `https:` ise `secure: true` ve
`__Secure-koala_admin_session`, değilse `koala_admin_session`).

Yanlış değer **sessizce "kimse giriş yapamıyor" olarak görünmez** — o, bu
doğrulama yazılmadan önceki tehlikeydi. `src/env.ts` açılışta fail-fast:

- Yoksa veya kök origin değilse süreç açılmaz (`instrumentation.ts` →
  `process.exit(1)`). 500 servis eden bir konteyner load balancer'a sağlıklı
  görünür; çıkan bir süreç görünmez.
- localhost dışında `http://` reddedilir (`localhost dışında https olmalı`).
  `http://admin.iskoala.com` hiç boot etmez.

Kalan sessiz yol: origin `https` iken istek düz HTTP ise tarayıcı `Secure`
çerezi saklamaz. Onu env kapatır; şema/host uyumsuzluğu hâlâ operatör işi.

## Kapılar

`package.json` script'leri. Ajan kapıyı Yusuf'un Mac'inde koşturur; GitHub
kuyruğunu beklemez. Mac org runner kaydedilmez. GitHub PR ve `main` push'ta
kalite işi koşmaz. Hetzner `self-hosted` yalnız `workflow_dispatch` ile
isteğe bağlıdır. Yerel tam kapı, PR açılmadan:

```
pnpm lint && pnpm format:check && pnpm typecheck && pnpm test && pnpm build && pnpm verify:server-only
```

İsteğe bağlı dispatch (`.github/workflows/ci.yml`) bugün `format:check`
**koşmuyor**. Koştuğu: `lint`, `typecheck`, `test`, `build`, ayrı işte
`verify:server-only`. `format:check`'i yerel kapıdan düşürme — YAML'ın
koşmaması, script'in olmaması değil.

`pnpm build` `KOALA_API_BASE_URL` ve `ADMIN_PUBLIC_ORIGIN` ister
(`.env.example` → `.env.local`; Git'e girmez). Dispatch bunları iş akışı
`env` bloğunda placeholder olarak verir; sır değiller.

### `verify:server-only`

`scripts/verify-server-only-guard.mjs`: Client Component'in
`@/server/api/koala` import etmesini eker, `next build`'in **kırılmasını**
ve gerekçenin `"cannot be imported from a Client Component"` olmasını
ister, planted dosyaları siler. Yeşil build burada kırmızı demektir —
token tarayıcıya inebilir. Ayrıntı: `docs/server-only-guard.md`.
Vitest `server-only`'yi stub'lar; bu script'in yerine geçmez.

## Commit ve PR

Değişiklik ayrı feature branch'te, PR ile. Doğrudan `main`'e push yok.
`git add .` kullanılmaz.

Başlık geleneği `git log`'da: squash başlıkları Conventional Commit,
İngilizce imperative, sonda `(#NN)` — `feat(payouts): … (#37)`. Trailer
yok (`Refs #`, `Signed-off-by` aranmıyor; log'da pratik olarak çıkmıyor,
koala-web'deki `Refs #NN` kuralı buraya kopyalanmaz). Gövde gerekçeyi
anlatır; zorunlu bir trailer şablonu yok.

## Sırlar

`.env.local` Git'e girmez. Panelin `NEXT_PUBLIC_*` değişkeni yok ve
olmamalı: o değerler tarayıcı bundle'ına girer. ADR-0014'ten beri ayrı
bir kimlik sağlayıcısı ve `AUTH_SECRET` yok; ilk OWNER sırrı
koala-backend'in `BOOTSTRAP_OWNER_*` tarafında.
