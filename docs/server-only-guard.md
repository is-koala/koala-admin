# `server-only` sınırı ve doğrulaması

Panelin taşıyıcı mimari kararı tek cümle: **tarayıcı `api.iskoala.com`'a hiç doğrudan konuşmaz.**
Backend'e giden her istek Next.js sunucusundan geçer — Route Handler, Server Action ya da RSC fetch.

Bu kararı kod düzeyinde tutan şey `src/server/api/koala.ts` dosyasının ilk satırıdır:

```ts
import "server-only";
```

Bir Client Component bu modülü import ederse **build kırılır**. Aynı satır `src/env.ts` başında da
durur; `KOALA_API_BASE_URL` de tarayıcıya inmez.

## Neden

- **Access token tarayıcı JS'ine hiç inmez.** Panelin izin listesinde `payout.release` var; token'ı
  okuyabilen bir XSS escrow'dan para salabilirdi.
- **Backend'in CORS'una `admin.iskoala.com` eklemek gerekmez.** `core/configs/CorsConfig.java`
  izinli origin'leri `app.cors.allowed-origins`'ten okuyor ve izinli başlıkları sabit bir listeyle
  sınırlıyor. Tarayıcıdan hiç istek çıkmadığı için bu listenin panelle işi olmuyor.
- **`X-Device-Id` / `X-App-Version` panele hiç uğramaz.** Bu başlıklar mobil/web istemci
  sözleşmesine ait. `core/configs/MinimumAppVersionFilter.java` başlık yokken kapıyı açık
  bırakıyor, `/admin/**` de koala-backend#14 ile kendi filtre zincirine taşınıyor — göndermek
  hiçbir şey kazandırmaz, panelin başka bir istemci için yazılmış sürüm kapısına takılmasına yol
  açar. `src/server/api/forbidden-headers.test.ts` her CI koşusunda `src/` altını tarayarak bu
  başlıkların geri gelmediğini doğrular.

## Doğrulama

Tek satırlık bir güvence, silindiğinde sessizce kaybolur. Onun için sınırın **çalıştığı** kanıtlanır,
varlığı değil:

```
pnpm verify:server-only
```

`scripts/verify-server-only-guard.mjs`:

1. `src/app/server-only-guard-probe/` altına `@/server/api/koala` import eden bir Client Component
   ve onu render eden bir sayfa yazar,
2. `next build` çalıştırır,
3. Build'in **başarısız** olmasını ve doğru gerekçeyle olmasını bekler,
4. Ne olursa olsun planted dosyaları siler.

Burada başarılı bir build, başarısızlık demektir: panelin access token'ı tarayıcıya gönderebileceği
anlamına gelir. Script bu durumda 1 ile çıkar.

> Dizin adı bilerek `server-only-guard-probe`. Next.js alt çizgiyle başlayan klasörleri (`_private`)
> routing dışı sayar; `__server-only-guard__` adı sessizce hiç route üretmez ve doğrulama boşa
> döner.

### Gözlenen çıktı

```
→ Planting a Client Component that imports src/server/api/koala.ts
→ Running `next build` (this is expected to FAIL)

./src/server/api/koala.ts:1:1
Error: 'server-only' cannot be imported from a Client Component module
> 1 | import "server-only";
    | ^^^^^^^^^^^^^^^^^^^^^

It should only be used from a Server Component.

Import traces:
  Client Component Browser:
    ./src/server/api/koala.ts [Client Component Browser]
    ./src/app/server-only-guard-probe/probe.tsx [Client Component Browser]
    ./src/app/server-only-guard-probe/page.tsx [Server Component]

✓ PASS: `next build` failed with exit code 1
```

### Vitest neden bu sınırı görmez

`test/stubs/server-only.ts`, Vitest içinde `server-only` paketini boş bir modüle bağlar. Gerçek
paket import edildiği anda fırlattığı için bu alias olmadan test koşucusu `koala.ts`'i hiç import
edemezdi.

Bu, sınırı zayıflatmaz: sınır Next.js bundler'ında yaşıyor, alias oraya dokunmuyor. Testlerin
göremediği şeyi `pnpm verify:server-only` gösteriyor — ikisi birbirinin yerine geçmez.

## Ortam değişkeni kapısı

Aynı mantık `src/env.ts` için de geçerli: değişkenler zod ile doğrulanır ve `src/instrumentation.ts`
bunu sunucu açılışında import eder. Eksik değişkenle sunucu **açılmaz**:

```
$ pnpm start
▲ Next.js 16.3.4
Ortam değişkenleri doğrulanamadı; uygulama başlatılmadı.
  - KOALA_API_BASE_URL: zorunlu (.env.local içinde tanımlayın)

`.env.example` dosyasını `.env.local` olarak kopyalayıp doldurun.
$ echo $?
1
```

`register()` hatayı yakalayıp `process.exit(1)` çağırır. Next varsayılan olarak süreci ayakta tutup
her isteğe 500 döndürür; 500 servis eden bir konteyner load balancer'a sağlıklı görünür, çıkan bir
süreç görünmez.
