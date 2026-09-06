"use client";

import { useEffect, useRef, type ReactNode } from "react";

import { cn } from "@/lib/cn";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: ReactNode;
  /** Buttons, rendered bottom-right. */
  footer?: ReactNode;
  className?: string;
}

/**
 * A modal built on the native `<dialog>` element.
 *
 * `showModal()` gives focus trapping, the top layer, inertness of the page
 * behind and Escape-to-close for free — which is most of the reason an admin
 * panel would otherwise reach for a dialog library.
 *
 * This is a Client Component, so it must never import anything under
 * `src/server/`. That is not a convention to remember: `src/server/api/koala.ts`
 * starts with `import "server-only"`, and the build fails if this file reaches
 * for it.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = ref.current;
    if (element === null) return;

    if (open && !element.open) {
      element.showModal();
    } else if (!open && element.open) {
      element.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby="koala-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClose={onClose}
      className={cn(
        "m-auto w-full max-w-lg rounded-xl border border-border-subtle bg-surface p-0 text-ink",
        "backdrop:bg-ink/40",
        className,
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <h2 id="koala-dialog-title" className="text-lg font-semibold">
            {title}
          </h2>
          {description ? <p className="text-sm text-ink-muted">{description}</p> : null}
        </div>

        {children ? <div className="text-sm">{children}</div> : null}

        {footer ? <div className="flex justify-end gap-2">{footer}</div> : null}
      </div>
    </dialog>
  );
}
