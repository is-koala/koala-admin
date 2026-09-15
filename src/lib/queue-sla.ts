/**
 * Ev karolarının SLA eşiği (koala-admin#111): bir kuyruk kaydının açık
 * kalabileceği süre. Backend "eşiği aşan kayıt sayısı" vermez; karo, kuyruğun
 * ilk {@link SLA_SAMPLE_SIZE} satırını tek istekle alır ve zamanı burada
 * ölçer. Örneklem sıralı geldiği için sayı ya kesindir ya da alt sınırdır;
 * hangisi olduğu {@link OverdueSummary.capped} ile söylenir, uydurulmaz.
 */

export const SLA_HOURS = 48;

/**
 * Bir karo isteğinin satır sayısı. Kuyruk başına bir istek (şikayet karosu
 * iki durumu ayrı ayrı ister, takılı ödeme karosu yedek yolda bir tane daha);
 * `1`'den büyük tek maliyet gövde boyutu. Hakediş ucunun tavanı 50
 * (PageableSanitizer değil), o yüzden 100 değil.
 */
export const SLA_SAMPLE_SIZE = 50;

export interface OverdueSummary {
  /** Eşiği aşan kayıt sayısı; `capped` doğruysa "en az bu kadar". */
  readonly count: number;
  readonly capped: boolean;
}

/**
 * Örneklem eskiden yeniye gelir, aşanlar baştadır. Örneklemin tamamı aşmışsa
 * ve kuyruk örneklemden büyükse sayı alt sınırdır (`capped`); aksi hâlde
 * kesindir, çünkü örneklemde aşmayan bir satır görüldüyse ondan sonrakiler
 * de aşmamıştır.
 *
 * Zaman damgası okunamayan satır aşmamış sayılır: eksik veri alarm üretmez.
 */
export function overdueSummary(
  timestamps: readonly (string | null)[],
  totalElements: number,
  now: Date,
  thresholdHours: number = SLA_HOURS,
): OverdueSummary {
  const cutoff = now.getTime() - thresholdHours * 60 * 60 * 1000;
  let inSample = 0;
  for (const value of timestamps) {
    if (isOverdue(value, cutoff)) inSample += 1;
  }
  const beyondSample = Math.max(0, totalElements - timestamps.length);
  // Boş örneklem hiçbir şey söylemez; "0+" yazmak sıfırı alarma çevirirdi.
  const exhausted = inSample > 0 && inSample === timestamps.length && beyondSample > 0;
  return { count: inSample, capped: exhausted };
}

function isOverdue(value: string | null, cutoff: number): boolean {
  if (value === null) return false;
  const time = Date.parse(value);
  return Number.isFinite(time) && time < cutoff;
}

/** "3" ya da "50+"; karo ve testler aynı metni okur. */
export function overdueCountText(summary: OverdueSummary, format: (n: number) => string): string {
  return summary.capped ? `${format(summary.count)}+` : format(summary.count);
}
