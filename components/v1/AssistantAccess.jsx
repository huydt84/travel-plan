"use client";

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
      <section className={styles.accessBoard} aria-labelledby="v1-access-title">
        <LanguageSwitcher />
        <Link className={styles.backLink} href="/">{t("assistantExtra.backSchedule")}</Link>
        <div>
          <h1 id="v1-access-title">{t("assistantExtra.title")}</h1>
          <p>{signedIn
            ? t("assistantExtra.access.restricted")
            : t("assistantExtra.access.signInHelp")}</p>
          {signedIn ? (
            <button className={styles.secondaryButton} type="button" onClick={() => signOut({ redirectTo: "/" })}>{t("assistantExtra.signOut")}</button>
          ) : (
            <button className={styles.primaryButton} type="button" onClick={() => signIn("google", { redirectTo: "/v1" })}>{t("assistantExtra.continueGoogle")}</button>
          )}
        </div>
      </section>
    </main>
  );
}
