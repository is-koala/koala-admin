# Yerel Keycloak

> **Geçici.** Keycloak projeden çıkıyor — [koala-backend ADR-0014](https://github.com/is-koala/koala-backend/blob/main/docs/adr/0014-keep-staff-identity-in-koala.md).
>
> Bu compose dosyası yalnız panelin bugünkü hâlini yerelde çalıştırabilmek için duruyor; `src/env.ts` `KEYCLOAK_CLIENT_SECRET`'i zorunlu tutuyor ve o kalkana kadar panel bir Keycloak olmadan açılmıyor. Auth katmanı Koala JWT'sine geçtiğinde bu dosya, [`keycloak-setup.md`](./keycloak-setup.md) ve `docker/keycloak/` birlikte silinecek.

`docker/keycloak/` altındaki compose dosyası ve realm import'u, `koala-staff` realm'inin **yerel
geliştirme kopyasıdır**. Gerçek realm'in tek kaynağı [`keycloak-setup.md`](./keycloak-setup.md)
dosyasıdır; oradaki değerler burada tekrar edilmez, yalnız makine tarafından import edilir.

Bu kopya var, çünkü `auth.iskoala.com` henüz çözülmüyor: onsuz [#4](https://github.com/is-koala/koala-admin/issues/4)
kabul maddelerinin hiçbiri gözlemlenemezdi. Canlı realm kurulduğunda `.env.local` içindeki üç
değişkeni değiştirmek yeter — panel kodu bu kopyaya hiçbir yerde bağlı değil.

## Çalıştırma

```bash
docker compose -f docker/keycloak/compose.yaml up -d
docker compose -f docker/keycloak/compose.yaml logs -f keycloak   # "Import finished successfully"
```

| | |
|---|---|
| Issuer | `http://localhost:8085/realms/koala-staff` |
| Admin konsolu | <http://localhost:8085/admin/> · `admin` / `admin` |
| Test kullanıcısı | `owner@koala.local` / `owner-local-dev` — `OWNER` rolünde |
| Client secret | `local-dev-only-koala-admin-web-secret` |

Bu üç parola **atılabilir ve yalnız yereldir**; `localhost` dışında hiçbir şeye erişim vermezler ve
canlı ortamda karşılıkları yoktur. Canlı client secret'ı yalnız `.env.local` / deploy ortamına
girer, hiçbir izlenen dosyaya yazılmaz.

Host'un 8080 portu Koala backend'inde olduğu için Keycloak **8085**'te yayın yapar. Panelin
`.env.local` dosyasına gireceği değerler `.env.example` içinde yazılı.

Sıfırlamak (realm'i bozduysanız — import yalnız boş veritabanına çalışır):

```bash
docker compose -f docker/keycloak/compose.yaml down -v
docker compose -f docker/keycloak/compose.yaml up -d
```

## Canlı kurulumdan bilerek ayrıldığı iki nokta

1. **`start-dev`, `start` değil.** Prod modu düz HTTP'yi reddediyor, bu konteynerin bütün amacı ise
   `http://localhost`. Panelin gerçekten bağlı olduğu her şey (ömürler, roller, client, mapper'lar)
   realm dosyasından geliyor, moddan değil.
2. **Refresh token rotation açık** (`revokeRefreshToken`, `refreshTokenMaxReuse: 0`). Kurulum
   rehberi bunu söylemiyor; burada açık, çünkü [#4](https://github.com/is-koala/koala-admin/issues/4)
   "aynı refresh token'ı iki kez kullanma" kuralını **gözlemlenebilir** kılmanın tek yolu bu. Yerel
   kopya bu tek maddede canlıdan daha katı.

Bunların dışında realm dosyası kurulum rehberiyle birebirdir. Uyuşmazlık görürseniz rehber haklıdır.

## Audience mapper'ını kapatıp hatayı görmek

Kabul maddelerinden biri, `aud` yanlışken çıkan hatanın "yetkin yok" hatasından ayırt edilebilir
olması. Denemek için admin konsolunda `koala-admin-web` → Client scopes → `koala-admin-web-dedicated`
→ `koala-api audience` mapper'ında **Add to access token**'ı kapatın, sonra panele yeniden girin.
(Rehber bu mapper'ın "Included Client Audience" alanını anlatıyor; realm dosyasında karşılığı
`included.custom.audience`, çünkü `koala-api` adında bir client yok.)
