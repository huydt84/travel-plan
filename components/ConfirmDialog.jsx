"use client";
import contributionsStyles from "../src/styles/contributions.module.css";

import styles from "./ConfirmDialog.module.css";
import Button from "./ui/Button";

import { useRef } from "react";
import Dialog, { DialogTitle, DialogDescription } from "./ui/Dialog";

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
  const safeActionRef = useRef(null);

  return (
    <Dialog
      onClose={onCancel}
      pending={pending}
      initialFocusRef={safeActionRef}
      overlayClassName={`${contributionsStyles["suggestion-overlay"]} ${styles["confirmation-overlay"]}`}
      role="alertdialog"
      aria-describedby="confirmation-dialog-description"
    >
      <section className={styles["confirmation-dialog"]}>
        <DialogTitle asChild>
          <h2>{title}</h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p id="confirmation-dialog-description">{description}</p>
        </DialogDescription>
        {preview && <blockquote>{preview}</blockquote>}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className={styles["confirmation-dialog-actions"]}>
          <Button
            type="button"
            variant="ghost"
            onClick={onCancel}
            disabled={pending}
            ref={safeActionRef}
          >
            Huỷ
          </Button>
          <Button
            type="button"
            variant="danger"
            onClick={onConfirm}
            disabled={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </section>
    </Dialog>
  );
}
