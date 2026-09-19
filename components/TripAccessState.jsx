"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import LanguageSwitcher from "./LanguageSwitcher";
import ViewerMenu from "./ViewerMenu";
import { TypeIcon } from "./Icons";
import { useLocale } from "./LocaleProvider";
import styles from "../src/styles/trip-access.module.css";

export default function TripAccessState({ state, viewer = null, localPersonaSwitcher = false }) {
  const { t } = useLocale();
  const signedOut = state === "signed-out";
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><TypeIcon type="Transit" /><span>Travel Plan</span></Link>
        <div className={styles.utilities}>
          <LanguageSwitcher />
          {viewer && <ViewerMenu viewer={viewer} />}
          {!viewer && localPersonaSwitcher && <Link href="/dev/personas">Test personas</Link>}
        </div>
      </header>
      <section className={`${styles.stage} ${signedOut ? styles.signedOutStage : ""}`}>
        <div className={styles.contentRow}>
          <div className={styles.copy}>
            <h1>{signedOut ? t("visibility.accessTitle") : t("visibility.emptyTitle")}</h1>
            <p>{signedOut ? t("visibility.accessIntro") : t("visibility.emptyDescription")}</p>
            {!signedOut && (
              <div className={styles.actions}>
                <Link className={styles.primary} href="/trips/manage?create=1">{t("visibility.createTrip")}</Link>
                <Link className={styles.secondary} href="/requests">{t("visibility.sendRequest")}</Link>
              </div>
            )}
          </div>
          {signedOut ? (
            <aside className={styles.authPanel} aria-label={t("visibility.privateLabel")}>
              <div className={styles.authHeading}>
                <strong>AUTH</strong>
                <span>{t("visibility.privateLabel")}</span>
              </div>
              <p>{t("visibility.accessPrivacy")}</p>
              <div className={styles.actions}>
                <button type="button" onClick={() => signIn("google", { redirectTo: "/" })}>
                  {t("common.loginGoogle")}
                </button>
              </div>
            </aside>
          ) : (
            <aside className={styles.signal} aria-label={t("visibility.privateLabel")}>
              <strong>READY</strong>
              <span>{t("visibility.privateLabel")}</span>
            </aside>
          )}
        </div>
        <div className={styles.routeLine} aria-hidden="true"><span /><span /><span /></div>
      </section>
    </main>
  );
}
