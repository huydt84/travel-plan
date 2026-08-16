"use client";

import { useEffect, useEffectEvent, useRef } from "react";

export default function ConfirmDialog({
  title,
  description,
  preview = "",
  confirmLabel,
  pendingLabel = "Đang cập nhật…",
  pending = false,
  error = "",
  onCancel,
  onConfirm,
}) {
  const dialogRef = useRef(null);
  const safeActionRef = useRef(null);
  const returnFocusRef = useRef(null);
  const cancelDialog = useEffectEvent(onCancel);
  const readPending = useEffectEvent(() => pending);

  useEffect(() => {
    returnFocusRef.current = document.activeElement;
    safeActionRef.current?.focus();
    const handleEscape = (event) => {
      if (event.key === "Escape" && !readPending()) cancelDialog();
    };
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("keydown", handleEscape);
      returnFocusRef.current?.focus?.();
    };
  }, []);

  const keepFocusInside = (event) => {
    if (event.key !== "Tab") return;
    const focusable = dialogRef.current?.querySelectorAll("button:not(:disabled), [href], [tabindex]:not([tabindex='-1'])");
    if (!focusable?.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  };

  return (
    <div className="suggestion-overlay confirmation-overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !pending) onCancel();
    }}>
      <section
        className="confirmation-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirmation-dialog-title"
        aria-describedby="confirmation-dialog-description"
        ref={dialogRef}
        onKeyDown={keepFocusInside}
      >
        <h2 id="confirmation-dialog-title">{title}</h2>
        <p id="confirmation-dialog-description">{description}</p>
        {preview && <blockquote>{preview}</blockquote>}
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="confirmation-dialog-actions">
          <button type="button" className="admin-ghost" onClick={onCancel} disabled={pending} ref={safeActionRef}>Huỷ</button>
          <button type="button" className="admin-danger" onClick={onConfirm} disabled={pending}>{pending ? pendingLabel : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}
