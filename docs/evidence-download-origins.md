# `EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS` — imzalı indirme origin'leri

Kimlik fotoğrafları, şirket galerisi ve uyuşmazlık kanıtları tarayıcıya **same-origin BFF**
üzerinden iner: `/api/identity-verifications/…/download`, `/api/companies/…/images/…/download`,
`/api/disputes/…/evidence/…/download`. Backend depo S3 ise `302` ile kısa ömürlü imzalı bir adres
verir; BFF o adresi tarayıcıya vermez, dosyayı **sunucudan** alıp akıtır. Adresin origin'i bu
değişkendeki listede olmalıdır (`src/server/evidence/signed-download.ts`). Listede yoksa — ya da
liste boşsa — BFF hiçbir yeri takip etmez ve `502` döner.

## Belirti

- Panelde her fotoğraf kutusu "Fotoğraf yüklenemedi." der. Alt cümle nedeni ayırır:
  - _Depo indirme kaynağı tanımlı değil (EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS)._ → liste boş.
  - _Depo indirme kaynağı izin listesinde yok (EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS)._ → liste dolu
    ama depo origin'i eşleşmiyor.
  - _Depo yanıt vermedi; tekrar deneyin._ → liste doğru, depo ya da backend cevap vermedi.
  - _Fotoğraf bulunamadı ya da bu kayda erişiminiz yok._ → `404`; yapılandırma sorunu değil.
- Liste boşken üç nesne sayfasının üstünde personel uyarısı çıkar:
  "İmzalı indirme kaynakları tanımlı değil (`EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS`)".
- Sunucu günlüğünde (`console.warn`) reddedilen adresin **yalnız origin'i** yazar, yol ve imza
  yazmaz:
  - `evidence download allowlist is empty: EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS is not set, so the signed redirect to https://… was refused (set EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS=https://… and restart the panel)`
  - `evidence download origin not allowed: https://… (add it to EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS, comma-separated, and restart the panel)`
- `502` yanıtı personel için makineye okunur bir başlık taşır:
  `X-Koala-Download-Error: not_configured | origin_not_allowed | upstream`. Tarayıcı bunu
  `img onError` içinde göremez; fotoğraf kutusu aynı adrese `HEAD` atıp okur.

Günlük satırındaki origin **doğru değerin kendisidir**; aşağıdaki türetmeyi yapmadan da oradan
kopyalanabilir.

## Değeri backend yapılandırmasından türetme

Backend'in depo ayarları (`koala-backend` `.env`, `application.yaml` → `storage.*`):
`STORAGE_TYPE`, `STORAGE_BUCKET`, `STORAGE_REGION`, `STORAGE_ENDPOINT`.

| Backend ayarı                                   | İmzalı adresin origin'i                            | Örnek                                                |
| ----------------------------------------------- | -------------------------------------------------- | ---------------------------------------------------- |
| `STORAGE_TYPE=s3`, `STORAGE_ENDPOINT` **boş**   | `https://<STORAGE_BUCKET>.s3.<STORAGE_REGION>.amazonaws.com` | `https://koala-prod.s3.eu-central-1.amazonaws.com` |
| `STORAGE_TYPE=s3`, `STORAGE_ENDPOINT` **dolu**  | endpoint'in origin'i (şema + host + varsa port)     | `STORAGE_ENDPOINT=https://minio.internal:9000/` → `https://minio.internal:9000` |
| `STORAGE_TYPE=local`                            | origin yok; backend dosyayı `200` ile akıtır        | liste boş kalabilir                                  |

Neden böyle: `S3ClientConfig` özel endpoint verildiğinde `pathStyleAccessEnabled(true)` kurar,
yani bucket adresin **yolunda** durur ve origin endpoint'in kendisidir. Endpoint yokken AWS SDK
virtual-hosted stil üretir: bucket host'un başına gelir.

Kurallar (`src/env.ts` açılışta doğrular):

- Yalnız origin: şema + host + opsiyonel port. Yol, sorgu, sondaki `/` ve kimlik bilgisi
  reddedilir; `https://bucket.s3.eu-central-1.amazonaws.com/private` **açılmaz**.
- Yalnız `https`. Düz `http` yalnız loopback (`localhost`, `127.0.0.1`) için kabul edilir.
- Birden fazlası virgülle: `https://a.s3.eu-central-1.amazonaws.com,https://minio.internal:9000`.
  Boşluklar kırpılır, tekrarlar atılır.

## Uygulama

1. Admin panelin çalıştığı ortama (Dokploy → koala-admin → Environment) yaz:
   `EVIDENCE_DOWNLOAD_ALLOWED_ORIGINS=https://<bucket>.s3.<region>.amazonaws.com`
2. **Paneli yeniden başlat.** `src/env.ts` değeri süreç açılırken bir kez okur; çalışan sürece
   yeni değer ulaşmaz.
3. Bir kimlik incelemesi aç. Fotoğraflar geliyorsa bitti. Hâlâ "izin listesinde yok" diyorsa
   sunucu günlüğündeki `evidence download origin not allowed: https://…` satırı gerçek origin'i
   söyler; onu listeye ekleyip yeniden başlat.

## Değişmeyen tasarım

Backend'in `302` kararı (depo adresini tarayıcıdan gizleme) bu değişkenle ilgili değildir ve
değişmez. Liste bir güvenlik sınırıdır: BFF personel çerezi olan bir süreçtir ve backend'in
verdiği her adrese körlemesine gitmemelidir (`route.test.ts` içindeki `attacker.test` testleri).
Boş liste bu yüzden **fail-closed**: sessizce açılmaz, sesli reddeder.
