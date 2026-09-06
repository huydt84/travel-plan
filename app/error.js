"use client";
import trackerStyles from "../src/styles/tracker.module.css";
import { useLocale } from "../components/LocaleProvider";
import LanguageSwitcher from "../components/LanguageSwitcher";

export default function ErrorPage({ reset }) {
  const { t } = useLocale();
  return (
    <main className="shell">
      <section className="now-card error-card">
        <LanguageSwitcher />
        <h1>{t("errors.scheduleTitle")}</h1>
        <p>{t("errors.scheduleHelp")}</p>
        <button
          className={trackerStyles["jump-button"]}
          type="button"
          onClick={reset}
        >
          {t("assistant.retry")}
        </button>
      </section>
    </main>
  );
}
