"use client";

import { useState } from "react";
import { sharedItineraryMarkdown, sharedItineraryText } from "../lib/trip-share.mjs";
import { useLocale } from "./LocaleProvider";
import styles from "./shared-trip.module.css";

export default function SharedTripActions({ itinerary }) {
  const { t } = useLocale();
  const [status, setStatus] = useState("");

  async function copy() {
    const text = sharedItineraryText(itinerary, { day: t("share.day"), sources: t("share.sources") });
    try {
      await navigator.clipboard.writeText(text);
      setStatus(t("share.copiedText"));
    } catch {
      setStatus(t("share.copyError"));
    }
  }

  function exportMarkdown() {
    const markdown = sharedItineraryMarkdown(itinerary, { day: t("share.day"), sources: t("share.sources") });
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${itinerary.trip.title.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "itinerary"}.md`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(t("share.markdownReady"));
  }

  return <div className={styles.actions}>
    <div className={styles.actionButtons}>
      <button type="button" onClick={copy}>{t("share.copyText")}</button>
      <button type="button" onClick={exportMarkdown}>{t("share.exportMarkdown")}</button>
      <button type="button" onClick={() => window.print()}>{t("share.exportPdf")}</button>
    </div>
    <span role="status" aria-live="polite">{status}</span>
  </div>;
}
