"use client";

import { useState } from "react";

import { ErrorState } from "@/components/ui";

/**
 * TCKK fotoğrafı. `onError` şart: BFF 403/404/502'yi kırık img olarak
 * gösterir; o görüntü başarılı kanıt gibi durmasın, personel yeniden densin.
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
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  return (
    <figure className="flex flex-col gap-2">
      <figcaption className="text-sm font-medium text-ink">{label}</figcaption>
      {documentId === null ? (
        <p className="rounded-lg border border-border-subtle bg-surface-sunken px-3 py-8 text-center text-sm text-ink-muted">
          {emptyLabel}
        </p>
      ) : failed ? (
        <ErrorState
          title="Fotoğraf yüklenemedi."
          description="İndirme veya görüntüleme başarısız oldu. Bu kutu onaylanmış bir fotoğraf değildir."
          action={
            <button
              type="button"
              onClick={() => {
                setFailed(false);
                setAttempt((current) => current + 1);
              }}
              className="w-fit rounded-md bg-brand px-3 py-2 text-sm font-medium text-white"
            >
              Tekrar dene
            </button>
          }
        />
      ) : (
        // eslint-disable-next-line @next/next/no-img-element -- same-origin BFF personel çerezini ister; next/image göndermez.
        <img
          src={identityPhotoSrc(reviewId, documentId, attempt)}
          alt={alt}
          onError={() => setFailed(true)}
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
