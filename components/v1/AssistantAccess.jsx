"use client";

import Image from "next/image";
import Link from "next/link";
import { useLocale } from "../LocaleProvider";
import { signIn, signOut } from "next-auth/react";
import styles from "./assistant.module.css";
import LanguageSwitcher from "../LanguageSwitcher";

export default function AssistantAccess({ viewer }) {
  const { t } = useLocale();
  const signedIn = Boolean(viewer?.email);
  return (
    <main className={styles.accessShell}>
      <div className={styles.accessVisual} aria-hidden="true">
        <Image
          className={styles.accessImage}
          src="/images/assistant-access.webp"
          alt=""
          fill
          preload
          sizes="(max-width: 767px) 100vw, 44vw"
        />
      </div>
      <section className={styles.accessBoard} aria-labelledby="v1-access-title">
        <header className={styles.accessUtilities}>
          <Link className={styles.backLink} href="/">{t("assistantExtra.backSchedule")}</Link>
          <LanguageSwitcher />
        </header>
        <div className={styles.accessContent}>
          <h1 id="v1-access-title">{t("assistantExtra.title")}</h1>
          <p>{signedIn
            ? t("assistantExtra.access.restricted")
            : t("assistantExtra.access.signInHelp")}</p>
          {signedIn ? (
            <button className={`${styles.secondaryButton} ${styles.accessAction}`} type="button" onClick={() => signOut({ redirectTo: "/" })}>{t("assistantExtra.signOut")}</button>
          ) : (
            <button className={`${styles.primaryButton} ${styles.accessAction}`} type="button" onClick={() => signIn("google", { redirectTo: "/assistant" })}>{t("assistantExtra.continueGoogle")}</button>
          )}
        </div>
      </section>
    </main>
  );
}
