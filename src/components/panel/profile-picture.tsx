import { httpUrlOrNull } from "@/lib/external-url";
import { EMPTY_VALUE } from "@/lib/format";

/**
 * `SafeUserDto.profilePictureUrl` — kullanıcı ve atama sayfaları (koala-admin#99).
 *
 * Backend'in verdiği adres olduğu gibi çizilir; şikayet görseli ve rozet
 * simgesiyle aynı kalıp. İmzalı indirme BFF'i yok: profil fotoğrafı kanıt
 * değil, kullanıcı yüzeyinin de gösterdiği herkese açık görsel. Adres yoksa
 * ya da `http(s)` değilse boş değer yazılır ki "fotoğraf yok" ile "alan
 * çizilmedi" ayrışsın.
 */
export function ProfilePicture({
  url,
  name,
  size = "md",
}: {
  url: string | null;
  /** Alt metin için; görsel kime ait. */
  name: string;
  size?: "sm" | "md";
}) {
  const src = httpUrlOrNull(url);
  if (src === null) return <>{EMPTY_VALUE}</>;
  const dimension = size === "sm" ? "h-6 w-6" : "h-16 w-16";
  return (
    // eslint-disable-next-line @next/next/no-img-element -- backend'in verdiği depo adresi; şikayet sayfasıyla aynı kalıp.
    <img
      src={src}
      alt={`${name} profil fotoğrafı`}
      className={`${dimension} inline-block rounded-full border border-border-subtle object-cover align-middle`}
    />
  );
}
