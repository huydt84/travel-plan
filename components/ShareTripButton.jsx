"use client";

import { useState } from "react";
import Dialog, { DialogDescription, DialogTitle } from "./ui/Dialog";
import { useLocale } from "./LocaleProvider";
import { requestJson } from "../lib/request-json.mjs";
import styles from "./share-trip.module.css";
import { ActionIcon } from "./Icons";

export default function ShareTripButton({ slug, className = "" }) {
  const { t, intlLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  async function createLink() {
    setOpen(true);
    setBusy(true);
    setShare(null);
    setCopied(false);
    setError("");
    try {
      const result = await requestJson(`/api/trips/${encodeURIComponent(slug)}/share`, { method: "POST" });
      setShare({ url: new URL(result.path, window.location.origin).href, expiresAt: result.expiresAt });
    } catch {
      setError(t("share.createError"));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(share.url);
      setCopied(true);
      setError("");
    } catch {
      setError(t("share.copyError"));
    }
  }

  return <>
    <button type="button" className={className || styles.trigger} onClick={createLink}>
      <ActionIcon name="share" />
      <span>{t("share.create")}</span>
    </button>
    {open && <Dialog onClose={() => setOpen(false)} overlayClassName={styles.overlay}>
      <section className={styles.dialog}>
        <div className={styles.dialogHead}>
          <div>
            <DialogTitle asChild><h2>{t("share.title")}</h2></DialogTitle>
            <DialogDescription>{t("share.description")}</DialogDescription>
          </div>
          <button type="button" className={styles.close} onClick={() => setOpen(false)} aria-label={t("common.close")}>×</button>
        </div>
        {busy && <p role="status">{t("common.loading")}</p>}
        {share && <>
          <label className={styles.linkLabel} htmlFor="share-link">{t("share.linkLabel")}</label>
          <input id="share-link" readOnly value={share.url} onFocus={(event) => event.target.select()} />
          <p className={styles.expiry}>{t("share.expiresAt", { time: new Intl.DateTimeFormat(intlLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(share.expiresAt)) })}</p>
          <button type="button" className={styles.copy} onClick={copyLink}>{copied ? t("share.copied") : t("share.copyLink")}</button>
        </>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
    </Dialog>}
  </>;
}
