"use client";

import { useState } from "react";
import Dialog, { DialogDescription, DialogTitle } from "./ui/Dialog";
import { useLocale } from "./LocaleProvider";
import { requestJson } from "../lib/request-json.mjs";
import styles from "./share-trip.module.css";
import { ActionIcon } from "./Icons";

const SHARE_MINUTES_KEY = "travel-plan-share-minutes";
const validMinutes = (value) => Number.isInteger(value) && value >= 1 && value <= 60;

export default function ShareTripButton({ slug, className = "" }) {
  const { t, intlLocale } = useLocale();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [share, setShare] = useState(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [minutes, setMinutes] = useState("10");
  const linkIsCurrent = share && String(share.minutes) === minutes;

  function openDialog() {
    let duration = 10;
    try {
      const saved = Number(window.localStorage.getItem(SHARE_MINUTES_KEY));
      if (validMinutes(saved)) duration = saved;
    } catch { /* Storage may be unavailable; sharing still works. */ }
    setOpen(true);
    setShare(null);
    setCopied(false);
    setError("");
    setMinutes(String(duration));
    generateLink(duration);
  }

  async function generateLink(duration) {
    setBusy(true);
    setError("");
    try {
      const result = await requestJson(`/api/trips/${encodeURIComponent(slug)}/share`, { method: "POST", body: JSON.stringify({ minutes: duration }) });
      setShare({ url: new URL(result.path, window.location.origin).href, expiresAt: result.expiresAt, minutes: duration });
      setCopied(false);
      try { window.localStorage.setItem(SHARE_MINUTES_KEY, String(duration)); }
      catch { /* Storage may be unavailable; the link remains usable. */ }
    } catch {
      setError(t("share.createError"));
    } finally {
      setBusy(false);
    }
  }

  function createLink(event) {
    event.preventDefault();
    const duration = Number(minutes);
    if (!validMinutes(duration)) {
      setError(t("share.minutesError"));
      return;
    }
    generateLink(duration);
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
    <button type="button" className={className || styles.trigger} onClick={openDialog}>
      <ActionIcon name="share" />
      <span>{t("share.create")}</span>
    </button>
    {open && <Dialog onClose={() => setOpen(false)} pending={busy} overlayClassName={styles.overlay}>
      <section className={styles.dialog}>
        <div className={styles.dialogHead}>
          <div>
            <DialogTitle asChild><h2>{t("share.title")}</h2></DialogTitle>
            <DialogDescription>{t("share.description")}</DialogDescription>
          </div>
          <button type="button" className={styles.close} onClick={() => setOpen(false)} disabled={busy} aria-label={t("common.close")}>×</button>
        </div>
        <form onSubmit={createLink}>
          <label className={styles.linkLabel} htmlFor="share-minutes">{t("share.minutesLabel")}</label>
          <input id="share-minutes" type="number" inputMode="numeric" min="1" max="60" step="1" required value={minutes} onChange={(event) => setMinutes(event.target.value)} disabled={busy} />
          <p className={styles.hint}>{t("share.minutesHint")}</p>
          {!linkIsCurrent && <button type="submit" className={styles.copy} disabled={busy}>{busy ? t("common.loading") : share ? t("share.updateLink") : t("share.createLink")}</button>}
        </form>
        {linkIsCurrent && <>
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
