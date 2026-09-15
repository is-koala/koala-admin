import Link from "next/link";

import { FormField, TextInput, Button } from "@/components/ui";
import {
  DATE_FROM_PARAM,
  DATE_TO_PARAM,
  describeDateRange,
  hasDateRange,
  type DateRange,
} from "@/lib/date-range";
import { listHref } from "@/lib/panel-href";

/**
 * Liste sayfalarının ortak tarih aralığı kutusu (koala-admin#110).
 *
 * Arama kutusuyla aynı karar: sunucu bileşeni, `<form method="get">`, tarayıcı
 * kodu yok. Aralık `?baslangic=&bitis=` olarak adreste yaşar, sayfa onu
 * sunucuda okur ve backend'e `from`/`to` olarak iletir; süzülmüş bir liste
 * biletlere yapıştırılabilen bir bağlantıdır.
 *
 * Form yalnız iki günü değiştirir. Durum, arama, kimlik süzgeçleri ve sayfa
 * boyutu `state` ile gizli alan olarak taşınır ki tarih seçmek operatörün
 * kurduğu görünümü sıfırlamasın; `sayfa` her gönderimde `0`.
 *
 * Alan `createdAt`, gün sınırları Europe/Istanbul ve dahil — ipucu bunu
 * söyler çünkü "bitiş 14'ü" yazan biri 14'ünün akşamını da bekler ve
 * backend öyle davranır (koala-backend#301).
 */
export interface DateRangeFilterProps {
  /** Alan `id`'lerinin ön eki; sayfa başına benzersiz olmalı. */
  id: string;
  /** Sayfanın kendi yolu; "Tarihi kaldır" bağlantısı buraya döner. */
  pathname: string;
  range: DateRange;
  /** Aralığın yanında yaşaması gereken görünüm; `baslangic`, `bitis` ve `sayfa` yok sayılır. */
  state?: Readonly<Record<string, string>>;
}

const OWN_KEYS = new Set<string>([DATE_FROM_PARAM, DATE_TO_PARAM, "sayfa"]);

export function DateRangeFilter({ id, pathname, range, state = {} }: DateRangeFilterProps) {
  const carried = Object.entries(state).filter(([name]) => !OWN_KEYS.has(name));
  const active = hasDateRange(range);

  return (
    <form
      method="get"
      action={pathname}
      aria-label="Tarih aralığı"
      data-testid={`${id}-form`}
      className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-surface px-4 py-3 shadow-sm"
    >
      <input type="hidden" name="sayfa" value="0" />
      {carried.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}

      <div className="flex flex-wrap items-end gap-3">
        <FormField id={`${id}-from`} label="Başlangıç" hint="Oluşturulma günü, Europe/Istanbul.">
          {({ id: fieldId, describedBy }) => (
            <TextInput
              id={fieldId}
              name={DATE_FROM_PARAM}
              type="date"
              defaultValue={range.fromDay ?? ""}
              aria-describedby={describedBy}
            />
          )}
        </FormField>
        <FormField id={`${id}-to`} label="Bitiş" hint="Gün dahil, 23:59:59'a kadar.">
          {({ id: fieldId, describedBy }) => (
            <TextInput
              id={fieldId}
              name={DATE_TO_PARAM}
              type="date"
              defaultValue={range.toDay ?? ""}
              aria-describedby={describedBy}
            />
          )}
        </FormField>
        <Button size="sm" type="submit">
          Tarihe göre süz
        </Button>
        {active ? (
          <Link
            href={listHref(pathname, Object.fromEntries(carried))}
            className="text-sm text-brand hover:underline"
            data-testid={`${id}-clear`}
          >
            Tarihi kaldır
          </Link>
        ) : null}
      </div>

      {active ? (
        <p className="text-xs text-ink-muted" data-testid={`${id}-summary`}>
          Bu görünüm {describeDateRange(range)} aralığında oluşturulan kayıtları süzüyor.
        </p>
      ) : null}
    </form>
  );
}
