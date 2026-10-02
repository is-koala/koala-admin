/**
 * Kendi parolasını unutan ya da kilitlenen bir yöneticinin çıkış yolu.
 *
 * Tek sabit, iki yer: personel sayfasındaki kendi satırının gerekçesi
 * (`staff/page.tsx`) ve backend 409'unun açıklaması (`administration.ts`,
 * `STAFF_MEMBER_PASSWORD_RESET_SELF`). İki ayrı kopya ayrışmıştı — biri runbook'u
 * anıyordu, öbürü anmıyordu — o yüzden cümle burada tek yerde.
 *
 * Kendi başına okunur olmak zorunda: kendi satırında ekranda backend'in cümlesi
 * yok, personel de "backend" diye düşünmez. Backend reddinin kendi cümlesindeki
 * "oturum içinden değiştirin" ve "OWNER" ile uzlaştırma yalnız `administration.ts`
 * içinde, o cümlenin yanında yapılır; buraya girmez.
 *
 * İçerik doğru olmak zorunda: panelde oturum içinden parola değiştirme ekranı
 * yok (`/giris/parola` yalnız zorunlu ilk giriş adımı; `proxy.ts` bayrak kapalıyken
 * onu `/`'e yönlendirir, bkz. koala-admin#132). Parola atama `staff.manage`
 * iznine bağlı; varsayılan rollerde yalnız OWNER taşır.
 *
 * Metin HTML'e olduğu gibi girer ve testler aynen arar: tırnak, kesme işareti
 * ve `&` taşımaz.
 */
export const STAFF_SELF_RESET_RECOVERY =
  "Panelde kendi parolanızı değiştirebileceğiniz bir ekran yok. staff.manage yetkisi olan başka bir yönetici (varsayılan rollerde OWNER) size geçici parola atayabilir; bu kilidi de açar ve ilk girişte kendi parolanızı belirlersiniz. Tek OWNER sizseniz koala-backend deposundaki docs/runbooks/staff-recovery.md yordamını izleyin.";
