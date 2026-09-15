"use client";

import { useState } from "react";

import { Button } from "@/components/ui";
import {
  diagnoseDownload,
  PHOTO_LOAD_FAILURE_TEXT,
  type PhotoLoadFailure,
} from "@/lib/evidence-download";

type PhotoState =
  | { readonly attempt: number; readonly status: "loading" }
  | {
      readonly attempt: number;
      readonly status: "failed";
      /** `null`: teşhis isteği henüz dönmedi; genel metin gösterilir. */
      readonly failure: PhotoLoadFailure | null;
    };

/**
 * Şirket galeri karesi; kimlik fotoğrafındaki kutunun dar hâli. Kırık img
 * yerine nedenini söyleyen bir kare: BFF'nin 404'ü ile 502'si (depo origin'i
 * izin listesinde değil / depo yanıt vermedi) farklı cümle (koala-admin#93).
 */
export function GalleryPhoto({ src, alt }: { src: string; alt: string }) {
  const [state, setState] = useState<PhotoState>({ attempt: 0, status: "loading" });

  function explainFailure(attempt: number) {
    setState({ attempt, status: "failed", failure: null });
    void diagnoseDownload(retrySrc(src, attempt)).then((failure) => {
      setState((current) =>
        current.attempt === attempt && current.status === "failed"
          ? { attempt, status: "failed", failure }
          : current,
      );
    });
  }

  if (state.status === "failed") {
    return (
      <div
        role="alert"
        className="flex h-40 w-full flex-col justify-between gap-2 rounded-lg border border-danger/30 bg-danger-soft p-2 text-xs text-ink"
      >
        <p>
          <span className="font-semibold text-danger">Fotoğraf yüklenemedi. </span>
          {PHOTO_LOAD_FAILURE_TEXT[state.failure ?? "unknown"]}
        </p>
        <Button
          size="sm"
          className="w-fit"
          onClick={() => setState({ attempt: state.attempt + 1, status: "loading" })}
        >
          Tekrar dene
        </Button>
      </div>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element -- same-origin BFF personel çerezini ister; next/image göndermez.
    <img
      src={retrySrc(src, state.attempt)}
      alt={alt}
      onError={() => explainFailure(state.attempt)}
      className="h-40 w-full rounded-lg border border-border-subtle bg-surface-sunken object-cover"
    />
  );
}

function retrySrc(src: string, attempt: number): string {
  return attempt === 0 ? src : `${src}?dene=${attempt}`;
}
