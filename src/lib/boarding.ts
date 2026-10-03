/**
 * Servis biniş kanıtının sözlüğü (koala-admin#133, koala-backend#335 / T2).
 *
 * Hepsi yalnız gösterim: backend enum yazar, panel serbest dize okur ve
 * bilinmeyen kodu olduğu gibi yazar — yeni bir kaynak ya da bayrak yüzünden
 * atama sayfası düşmemeli. Panel bayrak üretmez; bayrak backend'in
 * makullük kararıdır ve "kapı değil, yalnız kanıt"tır (kaydı engellemez).
 *
 * `server-only` yok: yalnız metin işleme, zaman çizelgesi bileşeni de
 * kullanır.
 */

/**
 * Sözlük araması yalnız kendi anahtarlarında: `"constructor"` gibi bir kod
 * `Object.prototype`'tan işlev döndürmesin.
 */
function lookup<T>(dictionary: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(dictionary, key) ? dictionary[key] : undefined;
}

/** `entities/BoardingSource.java` — kaydı kimin, nasıl yazdığı. */
const BOARDING_SOURCE_LABELS: Readonly<Record<string, string>> = {
  WORKER_SCANNED_SHUTTLE_QR: "İşçi servis QR'ını okuttu",
  EMPLOYER_SCANNED_WORKER_QR: "İşveren işçi QR'ını okuttu",
  EMPLOYER_MARKED: "İşveren elle işaretledi",
};

export function boardingSourceLabel(source: string): string {
  return lookup(BOARDING_SOURCE_LABELS, source) ?? source;
}

/**
 * `entities/BoardingKind.java`. İki etiket de "kaydedildi/işaretlendi" der:
 * satır bir iddianın kaydıdır, binişin kendisinin kanıtı bayraklar ve
 * sürenin yanında okunur.
 */
const BOARDING_KIND_LABELS: Readonly<Record<string, string>> = {
  BOARDED: "Biniş kaydedildi",
  NO_SHOW: "Gelmedi olarak işaretlendi",
};

/** Bilinmeyen tür genel başlık alır ve kodunu parantezde taşır; olay yine görünür. */
export function boardingKindLabel(kind: string | null): string {
  if (kind === null) return "Biniş olayı";
  return lookup(BOARDING_KIND_LABELS, kind) ?? `Biniş olayı (${kind})`;
}

/**
 * `entities/BoardingRecorderRole.java`. `EMPLOYER` ilan sahibi ya da şirketin
 * yetkilisi olabilir (`JobEditors`); bu yüzden "işveren tarafı".
 */
const BOARDING_RECORDER_ROLE_LABELS: Readonly<Record<string, string>> = {
  WORKER: "İşçi",
  EMPLOYER: "İşveren tarafı",
};

export function boardingRecorderRoleLabel(role: string): string {
  return lookup(BOARDING_RECORDER_ROLE_LABELS, role) ?? role;
}

export interface BoardingFlagInfo {
  readonly code: string;
  readonly label: string;
  /** Bilinmeyen bayrakta `null`: panel olmayan bir açıklamayı uydurmaz. */
  readonly explanation: string | null;
}

/**
 * Biniş kaydına düşebilen bayraklar (`TimesheetPlausibilityFlag` enum'unun
 * biniş alt kümesi; `AdminTimelineEventDto.flags` şeması). Açıklamalar
 * backend davranışının özeti: eşikler (tolerans, uzaklık, geç gönderim
 * üst sınırı) ortamdan okunan ayardır, o yüzden sayı yazılmaz.
 */
export const BOARDING_FLAGS = [
  "LATE_SYNC",
  "DEVICE_TIME_IMPLAUSIBLE",
  "OFF_SCHEDULE",
  "FAR_FROM_STOP",
  "STATIC_QR",
] as const;

type BoardingFlagCode = (typeof BOARDING_FLAGS)[number];

const BOARDING_FLAG_TEXT: Readonly<
  Record<BoardingFlagCode, { readonly label: string; readonly explanation: string }>
> = {
  LATE_SYNC: {
    label: "Geç gönderim",
    explanation:
      "QR'ın süresi dolduktan sonra gönderildi; okutulduğu an geçerliydi. Çevrimdışı kalan telefonun kaydı sonradan yüklenmiş olabilir, kayıt anı cihazın bildirdiği an.",
  },
  DEVICE_TIME_IMPLAUSIBLE: {
    label: "Cihaz saati şüpheli",
    explanation:
      "Cihazın bildirdiği saat makul değildi (çok eski, ileride ya da QR'ın geçerli aralığının dışında); kayıt anı sunucu saatine ya da aralığın sınırına çekildi.",
  },
  OFF_SCHEDULE: {
    label: "Durak saatinden sapma",
    explanation:
      "Gidişte biniş, durağın kalkış saatinden izin verilen aralığın dışında kaydedildi.",
  },
  FAR_FROM_STOP: {
    label: "Duraktan uzak",
    explanation:
      "Gidişte okutma ya da işaretleme konumu durak pininden izin verilen uzaklığın ötesindeydi.",
  },
  STATIC_QR: {
    label: "Sabit QR",
    explanation:
      "Kâğıda basılı süresiz QR ile okutuldu; zaman penceresi yoktur, bu yüzden okutmanın tam anı QR ile doğrulanamaz.",
  },
};

function isBoardingFlag(code: string): code is BoardingFlagCode {
  return (BOARDING_FLAGS as readonly string[]).includes(code);
}

export function boardingFlagInfo(code: string): BoardingFlagInfo {
  if (!isBoardingFlag(code)) return { code, label: code, explanation: null };
  return { code, ...BOARDING_FLAG_TEXT[code] };
}

/**
 * Konumun çizelgedeki hâli. `shown` yalnız `user.read_pii` varken üretilir;
 * `withheld` olayın konum taşıdığını ama okuyanın göremediğini söyler (koordinat
 * kendisi taşınmaz); `none` olayda konum yok (işaretleme telefonundan konum
 * gelmedi ya da hesap silindi).
 */
export type BoardingLocation =
  | { readonly kind: "shown"; readonly latitude: string; readonly longitude: string }
  | { readonly kind: "withheld" }
  | { readonly kind: "none" };

/**
 * Bir biniş satırının çizelgede açıklayan bloğu. Düz veri: etiketler Türkçe
 * metin, zamanlar ISO dizesi (bileşen `formatDateTime` ile yazar).
 */
export interface BoardingEvidence {
  readonly sourceLabel: string | null;
  readonly recorderLabel: string | null;
  readonly stopLabel: string | null;
  /** Olay anındaki durağın kalkış saati (planlanan). */
  readonly plannedAt: string | null;
  /** İstemcinin bildirdiği yakalama anı; listeden işaretlemede boş olabilir. */
  readonly capturedAt: string | null;
  /** Sunucunun kaydı aldığı an. */
  readonly receivedAt: string | null;
  readonly distanceMeters: number | null;
  /** Dönüşte uzaklığın neden bayrak üretmediği; gidişte ya da yön bilinmiyorsa `null`. */
  readonly distanceNote: string | null;
  readonly flags: readonly BoardingFlagInfo[];
  readonly location: BoardingLocation;
}
