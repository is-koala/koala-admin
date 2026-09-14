import Link from "next/link";

import { EMPTY_VALUE } from "@/lib/format";
import { userHrefOrNull } from "@/lib/panel-href";
import { safeUserName, type SafeUser } from "@/server/api/users";

/**
 * `SafeUserDto` tarafının adı, kimliği UUID ise kullanıcı sayfasına bağlı.
 * Taraf yoksa "—": bir tutarın yanında boşluk, kimin parası olduğunu
 * gizler. Liste ve nesne sayfaları aynı bileşeni kullansın diye burada.
 */
export function SafeUserLink({ user }: { user: SafeUser | null }) {
  if (user === null) return <>{EMPTY_VALUE}</>;
  const href = userHrefOrNull(user.id);
  if (href === null) return <>{safeUserName(user)}</>;
  return (
    <Link href={href} className="text-brand hover:underline">
      {safeUserName(user)}
    </Link>
  );
}
