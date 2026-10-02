/**
 * Kendi parolasını unutan ya da kilitlenen bir yöneticinin çıkış yolu.
 *
 * Tek sabit, iki yer: personel sayfasındaki kendi satırının gerekçesi
 * (`staff/page.tsx`) ve backend 409'unun açıklaması (`administration.ts`,
 * `STAFF_MEMBER_PASSWORD_RESET_SELF`). İki ayrı kopya ayrışmıştı — biri runbook'u
 * anıyor, öbürü anmıyordu — o yüzden cümle burada tek yerde.
 *
 * Neden böyle yazıldı:
 *  - Backend reddinin kendi cümlesi "oturum içinden değiştirin ya da başka bir
 *    OWNER'dan isteyin" der. Panelde oturum içinden parola değiştirme ekranı
 *    yok (`/giris/parola` yalnız zorunlu ilk giriş adımı; `proxy.ts` bayrak
 *    kapalıyken onu `/`'e yönlendirir), bu yüzden o yarısı panelde karşılıksız ve
 *    burada açıkça söyleniyor.
 *  - Backend "OWNER" der, kural `staff.manage` iznidir: parola atama o izne
 *    bağlı. Varsayılan rollerde yalnız OWNER taşıdığı için ikisi çelişmez;
 *    cümle ikisini birlikte söyler.
 *
 * Metin HTML'e olduğu gibi girer ve testler aynen arar: tırnak, kesme işareti
 * ve `&` taşımaz.
 */
export const STAFF_SELF_RESET_RECOVERY =
  "Panelde oturum içinden parola değiştirme ekranı yok; backend cümlesindeki oturum içinden yol burada sunulmuyor. Yol şu: staff.manage iznini taşıyan başka bir personel (varsayılan rollerde yalnız OWNER; backend cümlesindeki OWNER budur) size geçici bir parola atar, bu kilidi de açar, siz de ilk girişte kendi parolanızı belirlersiniz. Tek OWNER iseniz bu yol kapalıdır: koala-backend deposundaki docs/runbooks/staff-recovery.md yordamı gerekir.";
