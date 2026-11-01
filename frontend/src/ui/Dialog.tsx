import { useEffect, useRef, type ReactNode } from "react";

/**
 * Modal confirmation built on the native <dialog>: focus trapping, Escape
 * and the backdrop come from the browser, no dependency needed.
 */
export function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
  tone = "default",
}: {
  open: boolean;
  title: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  onClose: () => void;
  tone?: "default" | "danger";
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      className={`dialog dialog-${tone}`}
      onClose={onClose}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 className="dialog-title">{title}</h2>
      <div className="dialog-body">{children}</div>
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}
