/**
 * Kuyruk ile nesne sayfası (`[id]`) aynı segmentin iki çocuğu. `(panel)/`
 * seviyesindeki Suspense ikisinin de üstünde ve zaten çizilmiş; kuyruktan
 * nesneye ya da nesneden kuyruğa geçişte React o sınırı yeniden askıya
 * almaz ve eski sayfa yenisi gelene dek ekranda kalır. Bu dosya sınırı
 * değişen çocuğun etrafına koyar; görünüm ortak olanın aynısı (koala-admin#85).
 */
export { default } from "../loading";
