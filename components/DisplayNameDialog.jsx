"use client";

import { useRef, useState } from "react";
import { useLocale } from "./LocaleProvider";
import contributionsStyles from "../src/styles/contributions.module.css";
import styles from "./DisplayNameDialog.module.css";
import Button from "./ui/Button";
import Dialog, { DialogDescription, DialogTitle } from "./ui/Dialog";

export default function DisplayNameDialog({
  displayName,
  endpoint,
  onCancel,
  onSaved,
}) {
  const { t } = useLocale();
  const [value, setValue] = useState(displayName || "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const save = async (event) => {
    event.preventDefault();
    if (!value.trim()) {
      setError(t("profile.displayNameRequired"));
      inputRef.current?.focus();
      return;
    }
    setPending(true);
    setError("");
    try {
      const response = await fetch(endpoint, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: value }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || t("profile.saveError"));
      onSaved(result.displayName || result.name || value.trim());
    } catch (saveError) {
      setError(saveError.message || t("profile.saveError"));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      onClose={onCancel}
      pending={pending}
      initialFocusRef={inputRef}
      overlayClassName={`${contributionsStyles["suggestion-overlay"]} ${styles.overlay}`}
      role="dialog"
      aria-describedby="display-name-dialog-description"
    >
      <section className={styles.dialog}>
        <DialogTitle asChild>
          <h2>{t("profile.editTitle")}</h2>
        </DialogTitle>
        <DialogDescription asChild>
          <p id="display-name-dialog-description" className={styles.description}>
            {t("profile.description")}
          </p>
        </DialogDescription>
        <form onSubmit={save}>
          <label className={styles.field} htmlFor="display-name-input">
            {t("profile.displayName")}
            <input
              ref={inputRef}
              id="display-name-input"
              name="displayName"
              value={value}
              maxLength={120}
              autoComplete="nickname"
              onChange={(event) => setValue(event.target.value)}
              disabled={pending}
            />
          </label>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button type="button" variant="ghost" onClick={onCancel} disabled={pending}>
              {t("common.cancel")}
            </Button>
            <Button type="submit" variant="primary" disabled={pending}>
              {pending ? t("common.saving") : t("common.save")}
            </Button>
          </div>
        </form>
      </section>
    </Dialog>
  );
}
