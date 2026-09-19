"use client";

import { useLocale } from "../../../components/LocaleProvider";
import styles from "../../../components/shared-trip.module.css";

export default function SharedTripNotFound() {
  const { t } = useLocale();
  return <main className={styles.shell}><section className={styles.unavailable}><span className={styles.kicker}>{t("share.kicker")}</span><h1>{t("share.unavailableTitle")}</h1><p>{t("share.unavailableDescription")}</p></section></main>;
}
