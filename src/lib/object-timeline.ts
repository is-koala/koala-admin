import type { AuditEntry } from "@/lib/audit-log";
import type { BoardingEvidence } from "@/lib/boarding";

/**
 * Nesne başına birleşik zaman çizelgesinin sözlüğü (koala-admin#107).
 *
 * İki kaynak tek listede buluşur: nesnenin kendi DTO'sundan türeyen anlar
 * (oluşturulma, durum geçişleri, mesai, karar zamanı) ve personelin o nesne
 * üzerinde yaptıklarını kaydeden denetim satırları. İkisi de aynı biçime
 * indirgenir ki tek sıralama ve tek tablo yetsin; hangi kaynaktan geldiği
 * `source` ile kalır çünkü okuyan kişi "sistem böyle yazdı" ile "personel
 * bunu yaptı" ayrımını görmek ister.
 *
 * Bu dosya ağ bilmez: DTO olaylarını sayfa üretir, denetim satırlarını
 * bileşen ister, birleştirme burada.
 */

export type TimelineSource = "record" | "audit";

/**
 * Bir olayın faili. Personel için `staffId` (ve varsa görünen ad); pazaryeri
 * kullanıcısı için `userId` ve ad. Denetim satırında ad her zaman var
 * (`actorDisplayName`); DTO alanlarında (`resolvedByStaffId`,
 * `approvedByStaffId`) yalnız kimlik gelir — adı `ObjectTimeline` `staffRefs`
 * (koala-admin#112, `resolveStaffRefs`) ile tamamlar, çözülemeyen kısa kimlik kalır.
 */
export type TimelineActor =
  | { readonly kind: "staff"; readonly staffId: string | null; readonly name: string | null }
  | { readonly kind: "user"; readonly userId: string; readonly name: string };

export interface TimelineEvent {
  /** ISO-8601 an; sıralama anahtarı. Çözülemeyen tarih olay üretmez. */
  readonly at: string;
  readonly label: string;
  readonly detail: string | null;
  readonly actor: TimelineActor | null;
  readonly source: TimelineSource;
  /** Denetim satırında backend'in kararı; DTO olayında her zaman `true`. */
  readonly allowed: boolean;
  /** Satır anahtarı; denetimde satır kimliği, DTO'da etiket+an. */
  readonly key: string;
  /**
   * Servis biniş satırının kanıt bloğu (koala-admin#133): kaynak, üç zaman,
   * uzaklık, bayraklar, izinliyse konum. Yalnız biniş olayında dolu; denetim
   * ve diğer DTO olaylarında `null`.
   */
  readonly boarding: BoardingEvidence | null;
}

interface EventOptions {
  readonly detail?: string | null;
  readonly actor?: TimelineActor | null;
  readonly boarding?: BoardingEvidence | null;
}

function parsableInstant(at: string | null | undefined): at is string {
  return at !== null && at !== undefined && !Number.isNaN(new Date(at).getTime());
}

/**
 * DTO olaylarını toplayan küçük yardımcı. `push` tarihi çözülemeyen kaydı
 * sessizce atlar: sıralanamayan bir satır çizelgede yanlış yere oturur, hiç
 * oturmamasından kötü. Eski sunucunun göndermediği alanlar da böylece
 * yalnız yoklukla eksilir.
 */
export class TimelineBuilder {
  private readonly events: TimelineEvent[] = [];

  push(at: string | null | undefined, label: string, options: EventOptions = {}): this {
    if (!parsableInstant(at)) return this;
    this.events.push({
      at,
      label,
      detail: options.detail ?? null,
      actor: options.actor ?? null,
      source: "record",
      allowed: true,
      key: `record:${label}:${at}:${this.events.length}`,
      boarding: options.boarding ?? null,
    });
    return this;
  }

  build(): readonly TimelineEvent[] {
    return [...this.events];
  }
}

/** Denetim satırı → olay. Etiket backend'in `action` adı; izin ayrıntıda. */
export function auditTimelineEvents(entries: readonly AuditEntry[]): readonly TimelineEvent[] {
  return entries
    .filter((entry) => parsableInstant(entry.occurredAt))
    .map((entry) => ({
      at: entry.occurredAt,
      label: entry.action,
      detail: entry.permission,
      actor: { kind: "staff", staffId: entry.actorStaffId, name: entry.actorDisplayName },
      source: "audit",
      allowed: entry.allowed,
      key: `audit:${entry.id}`,
      boarding: null,
    }));
}

/**
 * Kaynakları tek kronolojiye indirir, eskiden yeniye. Aynı ana düşen iki
 * olayda önce DTO sonra denetim: sistemin yazdığı geçiş, onu tetikleyen
 * personel kararından önce okunur.
 */
export function mergeTimeline(
  ...sources: readonly (readonly TimelineEvent[])[]
): readonly TimelineEvent[] {
  return sources
    .flat()
    .map((event, index) => ({ event, index }))
    .sort((a, b) => {
      const byTime = new Date(a.event.at).getTime() - new Date(b.event.at).getTime();
      if (byTime !== 0) return byTime;
      if (a.event.source !== b.event.source) return a.event.source === "record" ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ event }) => event);
}
