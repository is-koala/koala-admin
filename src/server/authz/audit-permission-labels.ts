import type { AuditEntry } from "@/lib/audit-log";

import { isPermission, permissionLabel } from "./permissions";

/**
 * Bir denetim sayfasında geçen izinlerin Türkçe etiketleri.
 *
 * Sunucuda çözülür çünkü katalog `src/server/` altında, tablo ise Client
 * Component (`no-client-secrets.test.ts` sınırı korur; bir ipucu için
 * aşılmaya değmez). Kataloğun tanımadığı izin — backend bu derlemeden sonra
 * eklemiş — girdisiz kalır; satır düşmez, ham ad tek başına yazılır.
 * Denetim kaydı sayfası ve kullanıcı sayfasının denetim sekmesi paylaşır.
 */
export function permissionLabelsFor(entries: readonly AuditEntry[]): Record<string, string> {
  const labels: Record<string, string> = {};

  for (const entry of entries) {
    if (isPermission(entry.permission)) {
      labels[entry.permission] = permissionLabel(entry.permission);
    }
  }

  return labels;
}
