import { useEffect, useRef, type KeyboardEvent } from "react";

export interface ConfirmDialogProps {
  titleId: string;
  title: string;
  confirmLabel: string;
  /** Disables both actions while the confirmed operation is in flight. */
  pending?: boolean;
  onConfirm(): void;
  onCancel(): void;
}

/**
 * Native `<dialog>` confirmation.
 *
 * `showModal()` provides real modal semantics (top layer, background inert,
 * Escape fires `cancel`) where the platform implements it; the `open`
 * attribute fallback keeps the dialog usable in environments that do not
 * (jsdom ships `HTMLDialogElement` without `showModal`/`close`). Focus starts
 * on the non-destructive action and returns to the control that opened the
 * dialog.
 */
export function ConfirmDialog({
  titleId,
  title,
  confirmLabel,
  pending = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const isModal = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
      isModal.current = true;
    } else {
      dialog.setAttribute("open", "");
    }
    cancelRef.current?.focus();
    return () => {
      isModal.current = false;
      if (typeof dialog.close === "function" && dialog.hasAttribute("open")) dialog.close();
      dialog.removeAttribute("open");
      opener?.focus();
    };
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    // Only the non-modal fallback needs this: a native modal dialog already
    // reports Escape through `cancel`.
    if (!isModal.current && event.key === "Escape") onCancel();
  }

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={onCancel}
      onKeyDown={onKeyDown}
    >
      <h2 id={titleId}>{title}</h2>
      <button type="button" ref={cancelRef} disabled={pending} onClick={onCancel}>
        Cancel
      </button>
      <button type="button" disabled={pending} onClick={onConfirm}>
        {confirmLabel}
      </button>
    </dialog>
  );
}
