"use client";

import { useLocale } from "./LocaleProvider";
import navigationStyles from "../src/styles/navigation.module.css";
import { LOCALE_META } from "../lib/i18n.mjs";
import { ActionIcon } from "./Icons";

export default function LanguageSwitcher() {
  const { locale, locales, setLocale, t } = useLocale();
  return (
    <label className={navigationStyles["language-switcher"]}>
      <span className="sr-only">{t("language.choose")}</span>
      <select
        data-testid="language-switcher"
        aria-label={t("language.label")}
        title={LOCALE_META[locale].label}
        value={locale}
        onChange={(event) => setLocale(event.target.value)}
      >
        {locales.map((value) => (
          <option value={value} key={value}>{LOCALE_META[value].label}</option>
        ))}
      </select>
      <span aria-hidden="true" className={navigationStyles["language-switcher-display"]}>
        {LOCALE_META[locale].short}<ActionIcon name="down" />
      </span>
    </label>
  );
}
