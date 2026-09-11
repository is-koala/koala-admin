"use client";

import { useActionState } from "react";

import { initialDecisionState } from "@/components/panel/queue/decision-state";

import { submitImageRemoval } from "./actions";

export function ImageRemovalForm({ imageId }: { imageId: string }) {
  const [state, action, pending] = useActionState(submitImageRemoval, initialDecisionState);

  return (
    <form
      action={action}
      className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-surface-sunken px-4 py-3"
    >
      <input type="hidden" name="imageId" value={imageId} />
      <p className="text-sm text-ink">
        Görseli bütün ilan ve şirket galerilerinden düşürür. Depodaki dosya durur. Geri alınamaz.
      </p>
      {state.outcome === "error" ? (
        <p role="alert" className="text-sm text-danger">
          {state.message}
        </p>
      ) : null}
      {state.outcome === "success" ? (
        <p role="status" className="text-sm text-success">
          {state.message}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending || state.outcome === "success"}
        className="w-fit rounded-md border border-danger px-3 py-2 text-sm font-medium text-danger disabled:cursor-not-allowed disabled:opacity-60"
      >
        Görseli kaldır
      </button>
    </form>
  );
}
