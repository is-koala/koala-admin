import Link from "next/link";
import type { Route } from "next";
import type { ReactNode } from "react";

/**
 * Bir liste kimlik süzgeciyle daraltılmışken (`?isci=`, `?sirket=`,
 * `?kullanici=`) çizilen bilgi satırı ve "Süzgeci kaldır" bağlantısı
 * (koala-admin#100). Beş liste aynı cümle kalıbını taşır; `clearHref`
 * süzgeci düşürüp arama, durum ve sayfa boyutunu korur — o hesap sayfada,
 * çünkü hangi anahtarların "görünüm" olduğunu yalnız sayfa bilir.
 *
 * `QueueFilters.notice` içinde de kullanılır; orası bir `<p>` olduğu için
 * kök `<span>`: `<p>` içinde `<p>` geçersiz HTML.
 */
export function FilterNotice({
  children,
  clearHref,
  testId,
  inline = false,
}: {
  /** "Bu görünüm … süzüyor" cümlesi; kimlikler `<Mono>` ile. */
  children: ReactNode;
  clearHref: Route;
  testId: string;
  /** `QueueFilters.notice` gibi zaten bir paragrafın içindeyse. */
  inline?: boolean;
}) {
  const body = (
    <>
      {children}{" "}
      <Link href={clearHref} className="text-brand hover:underline">
        Süzgeci kaldır
      </Link>
      .
    </>
  );
  if (inline) return <span data-testid={testId}>{body}</span>;
  return (
    <p
      className="rounded-md border border-border-subtle bg-surface-sunken px-3 py-2 text-sm text-ink"
      data-testid={testId}
    >
      {body}
    </p>
  );
}

/** Süzgeç cümlesindeki kimlik. */
export function FilterId({ value }: { value: string }) {
  return <span className="font-mono text-xs">{value}</span>;
}
