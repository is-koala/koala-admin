import type { ReactNode } from "react";

import { Badge } from "@/components/ui";
import type { BoardingEvidence } from "@/lib/boarding";
import { EMPTY_VALUE, formatDateTime, formatDateTimeSeconds, formatInteger } from "@/lib/format";

/**
 * Servis biniş satırının kanıt bloğu (koala-admin#133): kaynak, üç zaman
 * (planlanan, cihazın bildirdiği, sunucunun aldığı), durağa uzaklık, konum ve
 * bayraklar. "İşçi bindim diyor, işveren binmedi diyor" anında personelin
 * kanıtı tek yerde okuması için.
 *
 * Bayrak bir engel değil kanıttır; metin bunu söyler. Koordinat bu bileşene
 * yalnız `user.read_pii` varken gelir (`assignmentTimelineEvents`); bileşen
 * izin bilmez, gelmeyen veriyi çizemez. Harita bağlantısı yok: panel konumu
 * bugüne dek yalnız sayı yazdı (`WorkSessions`).
 */
export function BoardingEvidenceBlock({ evidence }: { evidence: BoardingEvidence }) {
  return (
    <div className="mt-1 flex w-full flex-col gap-2 text-xs" data-testid="boarding-evidence">
      <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5">
        <Fact label="Kaynak">
          {evidence.sourceLabel ?? EMPTY_VALUE}
          {evidence.recorderLabel === null ? null : (
            <span className="text-ink-muted"> · Kaydeden: {evidence.recorderLabel}</span>
          )}
        </Fact>
        <Fact label="Durak">{evidence.stopLabel ?? EMPTY_VALUE}</Fact>
        <Fact label="Planlanan (durak saati)">{formatDateTime(evidence.plannedAt)}</Fact>
        <Fact label="Cihaz saati (okutma)">{formatDateTimeSeconds(evidence.capturedAt)}</Fact>
        <Fact label="Sunucuya ulaşma">{formatDateTimeSeconds(evidence.receivedAt)}</Fact>
        <Fact label="Durağa uzaklık">
          {evidence.distanceMeters === null ? (
            EMPTY_VALUE
          ) : (
            <>
              {formatInteger(evidence.distanceMeters)} m
              {evidence.distanceNote === null ? null : (
                <span className="text-ink-muted"> · {evidence.distanceNote}</span>
              )}
            </>
          )}
        </Fact>
        <Location location={evidence.location} />
      </dl>

      {evidence.flags.length === 0 ? null : (
        <div className="flex flex-col gap-1" data-testid="boarding-flags">
          <ul className="flex flex-col gap-1">
            {evidence.flags.map((flag) => (
              <li key={flag.code} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Badge tone="warning">{flag.label}</Badge>
                {flag.explanation === null ? null : (
                  <span className="max-w-prose text-ink-muted">{flag.explanation}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="max-w-prose text-ink-muted">
            Bayraklar kaydı engellemez; incelenmeye değer olduğunu söyler.
          </p>
        </div>
      )}
    </div>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-ink-muted">{label}</dt>
      <dd>{children}</dd>
    </>
  );
}

function Location({ location }: { location: BoardingEvidence["location"] }) {
  if (location.kind === "shown") {
    return (
      <Fact label="Konum">
        <span className="font-mono" data-testid="boarding-location">
          {location.latitude}, {location.longitude}
        </span>
      </Fact>
    );
  }
  if (location.kind === "withheld") {
    return (
      <Fact label="Konum">
        <span className="text-ink-muted" data-testid="boarding-location-withheld">
          Bu kayıt konum taşıyor; görmek için <code className="font-mono">user.read_pii</code>{" "}
          gerekir.
        </span>
      </Fact>
    );
  }
  return <Fact label="Konum">{EMPTY_VALUE}</Fact>;
}
