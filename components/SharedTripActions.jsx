"use client";

import { useState } from "react";
import { sharedItineraryText } from "../lib/trip-share.mjs";
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

  return <div className={styles.actions}>
    <button type="button" onClick={copy}>{t("share.copyText")}</button>
    <span role="status" aria-live="polite">{status}</span>
  </div>;
}
