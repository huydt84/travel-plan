"use client";

import Link from "next/link";
import { signIn } from "next-auth/react";
import LanguageSwitcher from "./LanguageSwitcher";
import ViewerMenu from "./ViewerMenu";
import { TypeIcon } from "./Icons";
import { useLocale } from "./LocaleProvider";
import styles from "../src/styles/trip-access.module.css";

export default function TripAccessState({ state, viewer = null }) {
  const { t } = useLocale();
  const signedOut = state === "signed-out";
  return (
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link href="/" className={styles.brand}><TypeIcon type="Transit" /><span>Travel Plan</span></Link>
        <div className={styles.utilities}>
          <LanguageSwitcher />
          {viewer && <ViewerMenu viewer={viewer} />}
        </div>
      </header>
      <section className={styles.stage}>
        <div className={styles.routeLine} aria-hidden="true"><span /><span /><span /></div>
        <div className={styles.copy}>
          <h1>{signedOut ? t("visibility.accessTitle") : t("visibility.emptyTitle")}</h1>
          <p>{signedOut ? t("visibility.accessDescription") : t("visibility.emptyDescription")}</p>
          <div className={styles.actions}>
            {signedOut ? (
              <button type="button" onClick={() => signIn("google", { redirectTo: "/" })}>
                {t("common.loginGoogle")}
              </button>
            ) : (
              <>
                <Link className={styles.primary} href="/trips/manage?create=1">{t("visibility.createTrip")}</Link>
                <Link className={styles.secondary} href="/requests">{t("visibility.sendRequest")}</Link>
              </>
            )}
          </div>
        </div>
        <aside className={styles.signal} aria-label={t("visibility.privateLabel")}>
          <strong>{signedOut ? "AUTH" : "READY"}</strong>
          <span>{t("visibility.privateLabel")}</span>
        </aside>
      </section>
    </main>
  );
}
