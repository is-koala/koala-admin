"use client";

import { useState } from "react";

import { ErrorState } from "@/components/ui";
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
 * TCKK fotoğrafı. `onError` şart: BFF 404/502'yi kırık img olarak gösterir;
 * o görüntü başarılı kanıt gibi durmasın, personel yeniden densin.
 *
 * Kırık img nedenini söylemez, o yüzden hata sonrası aynı adrese `HEAD` atılır
 * ve BFF'nin başlığı okunur (koala-admin#93): "bulunamadı / yetki yok" ile
 * "depo origin'i izin listesinde değil" farklı cümle olur.
 */
export function DocumentPhoto({
  reviewId,
  documentId,
  label,
  emptyLabel,
  alt,
}: {
  reviewId: string;
  documentId: string | null;
  label: string;
  emptyLabel: string;
  alt: string;
}) {
  const [state, setState] = useState<PhotoState>({ attempt: 0, status: "loading" });

  function explainFailure(src: string, attempt: number) {
    setState({ attempt, status: "failed", failure: null });
    void diagnoseDownload(src).then((failure) => {
      // "Tekrar dene" bu arada basıldıysa teşhis eski denemeye aittir; yeni
      // denemeyi hataya düşürmesin.
      setState((current) =>
        current.attempt === attempt && current.status === "failed"
          ? { attempt, status: "failed", failure }
          : current,
      );
    });
  }

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-ink">{label}</figcaption>
      {documentId === null ? (
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-8 text-center text-sm text-ink-muted">
          {emptyLabel}
        </p>
      ) : state.status === "failed" ? (
        <ErrorState
          title="Fotoğraf yüklenemedi."
          description={`${PHOTO_LOAD_FAILURE_TEXT[state.failure ?? "unknown"]} Bu kutu onaylanmış bir fotoğraf değildir.`}
          action={
            <button
              type="button"
              onClick={() => setState({ attempt: state.attempt + 1, status: "loading" })}
              className="w-fit rounded-md bg-brand px-3 py-2 text-sm font-medium text-white"
            >
              Tekrar dene
            </button>
          }
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin BFF personel çerezini ister; next/image göndermez.
        <img
          src={identityPhotoSrc(reviewId, documentId, state.attempt)}
          alt={alt}
          onError={() =>
            explainFailure(identityPhotoSrc(reviewId, documentId, state.attempt), state.attempt)
          }
          className="max-h-[28rem] w-full rounded-lg border border-border-subtle bg-surface-sunken object-contain"
        />
      )}
    </figure>
  );
}

function identityPhotoSrc(reviewId: string, documentId: string, attempt: number): string {
  const path = `/api/identity-verifications/${encodeURIComponent(reviewId)}/documents/${encodeURIComponent(documentId)}/download`;
  return attempt === 0 ? path : `${path}?dene=${attempt}`;
}
