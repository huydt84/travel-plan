"use client";

import { useRef, useState } from "react";
import Dialog, { DialogDescription, DialogTitle } from "./ui/Dialog";
import { useLocale } from "./LocaleProvider";
import { requestJson } from "../lib/request-json.mjs";
import styles from "./share-trip.module.css";
import { ActionIcon } from "./Icons";

const SHARE_MINUTES_KEY = "travel-plan-share-minutes";
const validMinutes = (value) => Number.isInteger(value) && value >= 1 && value <= 60;

export default function ShareTripButton({ slug, className = "" }) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [copying, setCopying] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [minutes, setMinutes] = useState("10");
  const preparedShare = useRef(null);
  const inFlight = useRef(new Map());
  const session = useRef(0);
  const selectedMinutes = useRef("10");

  function openDialog() {
    let duration = 10;
    try {
      const saved = Number(window.localStorage.getItem(SHARE_MINUTES_KEY));
      if (validMinutes(saved)) duration = saved;
    } catch { /* Storage may be unavailable; sharing still works. */ }
    const currentSession = session.current + 1;
    session.current = currentSession;
    preparedShare.current = null;
    setOpen(true);
    setCopied(false);
    setError("");
    setMinutes(String(duration));
    selectedMinutes.current = String(duration);
    setCopying(false);
    void prepareLink(duration, currentSession).catch(() => {
      // Preparation is opportunistic. If it fails, Copy retries and reports the error.
    });
  }

  function closeDialog() {
    session.current += 1;
    setOpen(false);
  }

  function prepareLink(duration, currentSession) {
    const prepared = preparedShare.current;
    if (prepared?.minutes === duration && Date.parse(prepared.expiresAt) > Date.now()) {
      return Promise.resolve(prepared);
    }

    const requestKey = `${currentSession}:${duration}`;
    const pending = inFlight.current.get(requestKey);
    if (pending) return pending;

    const request = (async () => {
      const result = await requestJson(`/api/trips/${encodeURIComponent(slug)}/share`, { method: "POST", body: JSON.stringify({ minutes: duration }) });
      const nextShare = { url: new URL(result.path, window.location.origin).href, expiresAt: result.expiresAt, minutes: duration };
      if (session.current === currentSession && Number(selectedMinutes.current) === duration) preparedShare.current = nextShare;
      return nextShare;
    })().finally(() => inFlight.current.delete(requestKey));

    inFlight.current.set(requestKey, request);
    return request;
  }

  async function copyLink(event) {
    event.preventDefault();
    const duration = Number(minutes);
    if (!validMinutes(duration)) {
      setError(t("share.minutesError"));
      return;
    }
    const currentSession = session.current;
    setCopying(true);
    setCopied(false);
    setError("");
    try {
      let share;
      try {
        share = await prepareLink(duration, currentSession);
      } catch {
        if (session.current === currentSession) setError(t("share.createError"));
        return;
      }
      if (session.current !== currentSession) return;
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(share.url);
      try { window.localStorage.setItem(SHARE_MINUTES_KEY, String(duration)); }
      catch { /* Storage may be unavailable; the link remains copied. */ }
      setCopied(true);
    } catch {
      if (session.current === currentSession) setError(t("share.copyError"));
    } finally {
      if (session.current === currentSession) setCopying(false);
    }
  }

  return <>
    <button type="button" className={className || styles.trigger} onClick={openDialog}>
      <ActionIcon name="share" />
      <span>{t("share.create")}</span>
    </button>
    {open && <Dialog onClose={closeDialog} pending={copying} overlayClassName={styles.overlay}>
      <section className={styles.dialog}>
        <div className={styles.dialogHead}>
          <div>
            <DialogTitle asChild><h2>{t("share.title")}</h2></DialogTitle>
            <DialogDescription>{t("share.description")}</DialogDescription>
          </div>
          <button type="button" className={styles.close} onClick={closeDialog} disabled={copying} aria-label={t("common.close")}>×</button>
        </div>
        <form onSubmit={copyLink}>
          <label className={styles.linkLabel} htmlFor="share-minutes">{t("share.minutesLabel")}</label>
          <input id="share-minutes" type="number" inputMode="numeric" min="1" max="60" step="1" required value={minutes} onChange={(event) => {
            setMinutes(event.target.value);
            selectedMinutes.current = event.target.value;
            setCopied(false);
            setError("");
          }} disabled={copying} />
          <p className={styles.hint}>{t("share.minutesHint")}</p>
          <button type="submit" className={`${styles.copy} ${copied ? styles.copySuccess : ""}`} disabled={copying} aria-live="polite">
            {copying ? <span className={styles.spinner} aria-hidden="true" /> : <ActionIcon name={copied ? "check" : "copy"} />}
            <span>{copying ? t("share.copying") : copied ? t("share.copied") : t("share.copyLink")}</span>
          </button>
        </form>
        {error && <p role="alert" className={styles.error}>{error}</p>}
      </section>
    </Dialog>}
  </>;
}
