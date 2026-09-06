# Keycloak kurulumu — `koala-staff` realm'i

> **Bu kurulum yapılmayacak. Keycloak kullanmıyoruz.**
>
> Karar: [koala-backend ADR-0014](https://github.com/is-koala/koala-backend/blob/main/docs/adr/0014-keep-staff-identity-in-koala.md) — personel kimliği de Koala'da tutulacak, panel Koala'nın kendi JWT'siyle giriş yapacak.
>
> Bu dosya **yalnız `src/server/auth/**` ve `src/env.ts` hâlâ bir Keycloak'a bağlı olduğu için** duruyor: panel `KEYCLOAK_CLIENT_SECRET` olmadan açılmıyor, yani bugün yerel geliştirme için hâlâ [`local-keycloak.md`](./local-keycloak.md) gerekiyor. Auth katmanı değiştirildiğinde bu dosya, `local-keycloak.md` ve `docker/keycloak/` birlikte silinecek.
>
> §3'teki rol grafiği ve görev ayrılığı kuralı **kalkmıyor**: içerik ADR-0014 §Rol grafiği'ne taşındı ve tek kaynağı orası. Buradaki kopyayı referans alma.
>
> Yeni bir Keycloak kurma. Canlıdaki (`auth.iskoala.com`) kurulum kaldırılıyor.

Bu dosya yalnız **senin elle yapacağın** adımları anlatır. Hiçbir adımda anahtar ya da parola bana iletme; sonunda bana yalnız üç değer lazım ve üçü de gizli değil.

Karar gerekçesi: [koala-backend ADR-0010](https://github.com/is-koala/koala-backend/blob/main/docs/adr/0010-split-staff-identity-from-koala-authorization.md)

---

## 0. Kapsam — neyi Keycloak yönetiyor, neyi yönetmiyor

| Keycloak | Koala backend |
|---|---|
| Kimlik, parola, MFA, kilitleme, oturum | Rolün hangi izinleri içerdiği |
| **Rol üyeliği** (kim hangi rolde) | Domain kuralları (kendi şirketini onaylayamaz vb.) |
| Personel ekleme / devre dışı bırakma | Denetim kaydı |

**Marketplace kullanıcıları Keycloak'a girmez.** Bu realm yalnız back-office personeli içindir. İş arayan ve işveren hesapları Koala'da kalır.

---

## 1. Keycloak'ı Dokploy'a kur

- Dokploy'da yeni servis: Docker image `quay.io/keycloak/keycloak` (güncel stabil sürümü sabitle, `latest` kullanma)
- Kendi PostgreSQL veritabanını ver — **Koala'nın veritabanını paylaştırma**
- Başlatma komutu `start` (prod modu), `start-dev` **değil**
- `KC_HOSTNAME` bir alt alan adı olsun, ör. `auth.iskoala.com`, ve TLS arkasında dursun
- İlk admin kullanıcısını ortam değişkenleriyle oluştur, sonra o değişkenleri kaldır

> **Bunu not et:** Keycloak düşerse panele hiç girilemez. Yedeğini ve sürüm yükseltmesini planla.

---

## 2. Realm

- Realm adı: **`koala-staff`**
- Realm settings → Sessions:
  - **Access Token Lifespan: 5 dakika.** Bu kısa süre bilinçli — rol iptali token yenilenene kadar geçerli olmaz, pencereyi 5 dakikada tutuyoruz
  - SSO Session Idle: 30 dakika · SSO Session Max: 8 saat
- Realm settings → Security defenses → **Brute force detection: ON**
  - Max login failures 5, wait 15 dakika. Kalıcı kilit **kullanma** — tek kullanıcıyken kendini kilitlersin
- Realm settings → Login: **User registration OFF**, Forgot password ON, Remember me OFF, Email as username ON

---

## 3. Roller (composite ile hiyerarşi)

Realm roles altında **önce yaprak rolleri**, sonra kapsayanları oluştur. Keycloak'ta bir rolü "composite" yapıp içine başka roller koyabilirsin — senin istediğin *"genel rol verince alt rolleri de gelir"* davranışı tam olarak budur.

Yaprak roller:

```
CATALOG_EDITOR
SUPPORT_AGENT
FINANCE_ANALYST
AUDITOR
```

Composite roller (içine alacakları):

```
MODERATOR         ← SUPPORT_AGENT
DISPUTE_HANDLER   ← SUPPORT_AGENT
COMPANY_APPROVER  ← SUPPORT_AGENT
TRUST_LEAD        ← MODERATOR + DISPUTE_HANDLER
FINANCE_OFFICER   ← FINANCE_ANALYST
OWNER             ← hepsi
```

`TRUST_LEAD`'in iki rolü birden kapsaması, bunun neden ağaç değil **DAG** olduğunun sebebi.

**Kural:** hiçbir rol hem trust dalını (`MODERATOR`/`DISPUTE_HANDLER`) hem finans dalını (`FINANCE_*`) birden kapsamamalı — `OWNER` hariç. Görev ayrılığı bu.

Rolün *ne yapabildiği* Keycloak'ta tanımlanmaz; Koala'daki rol→izin tablosunda durur. Keycloak yalnız kimin hangi rolde olduğunu söyler.

---

## 4. Client — admin paneli

Clients → Create:

- Client ID: **`koala-admin-web`**
- Client authentication: **ON** (confidential — Next.js sunucu tarafı olduğu için secret güvenle saklanabilir)
- Authentication flow: **Standard flow** açık; Direct access grants **kapalı**; Implicit **kapalı**
- Valid redirect URIs: `https://admin.iskoala.com/api/auth/callback/keycloak` (yerel geliştirme için ayrıca `http://localhost:3000/api/auth/callback/keycloak`)
- Valid post logout redirect URIs: `https://admin.iskoala.com/*`
- Web origins: `https://admin.iskoala.com`

### Rollerin token'a girmesi

Client scopes → `koala-admin-web-dedicated` → Add mapper → **User Realm Role**
- Token Claim Name: `realm_access.roles` (varsayılan)
- Add to access token: **ON**

### Backend'in token'ı doğrulayabilmesi

Koala backend bu token'ı doğrulayacak, o yüzden hedef kitle (audience) doğru olmalı:

Client scopes → `koala-admin-web-dedicated` → Add mapper → **Audience**
- Included Client Audience: `koala-api`
- Add to access token: **ON**

(`koala-api` adında ayrı bir client oluşturmana gerek yok; yalnız audience değeri olarak kullanılıyor.)

---

## 5. MFA

Authentication → Policies → **OTP Policy**: varsayılan TOTP ayarları yeterli.

Şimdilik **zorunlu yapma** — kendin kurarken kilitlenmemek için. Ama **ikinci kişi eklenmeden önce** Authentication → Required actions → `Configure OTP` → **Set as default action: ON** yap.

---

## 6. Kullanıcılar

**Sen:**
- Users → Add user, e-posta adresinle, Email verified ON
- Credentials → parola belirle, Temporary OFF
- Role mapping → **`OWNER`** ata

**Mühürlü yedek hesap** (kilitlenme kurtarması — Q11 kararı):
- İkinci bir kullanıcı oluştur, ör. `break-glass`
- `OWNER` rolünü ata
- Parolasını üret, **kağıda yaz ve kasaya koy** — hiçbir yerde dijital tutma
- Kullanıcıyı **Enabled: OFF** yap. İhtiyaç anında Keycloak konsolundan aktifleştirilir

> Kasadaki zarfa **Keycloak admin konsolunun parolasını da** koy. Keycloak admin'ini kaybedersen realm'e hiç giremezsin.

---

## 7. Bana lazım olan üç değer (üçü de gizli değil)

Kurulum bitince bunları söyle:

```
1. Issuer URL   → https://auth.iskoala.com/realms/koala-staff
2. Client ID    → koala-admin-web
3. Audience     → koala-api
```

Backend bunlarla JWKS'i çekip token doğrulayacak.

**Client secret'ı bana gönderme.** O yalnız admin panelinin deploy ortamına girer (`KEYCLOAK_CLIENT_SECRET`), tıpkı Google anahtarında yaptığımız gibi.

---

## 8. Kurulum sonrası kontrol listesi

- [ ] `start-dev` değil `start` ile çalışıyor
- [ ] TLS arkasında, `KC_HOSTNAME` doğru
- [ ] Kendi veritabanı var, Koala'nınkini paylaşmıyor
- [ ] Access token ömrü 5 dakika
- [ ] Brute force detection açık, kalıcı kilit kapalı
- [ ] User registration kapalı
- [ ] Composite roller kuruldu; hiçbiri trust + finans dallarını birden kapsamıyor (`OWNER` hariç)
- [ ] `koala-admin-web` confidential, direct access grants kapalı
- [ ] Realm role ve audience mapper'ları access token'a ekleniyor
- [ ] Senin hesabın `OWNER` rolünde
- [ ] Mühürlü yedek hesap oluşturuldu, devre dışı, parolası kasada
- [ ] Keycloak admin parolası da kasada
- [ ] İlk admin ortam değişkenleri kaldırıldı
