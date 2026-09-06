"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALE_META, getIntlLocale, normalizeLocale, SUPPORTED_LOCALES, translate } from "../lib/i18n.mjs";

const LocaleContext = createContext(null);

export function LocaleProvider({ initialLocale = DEFAULT_LOCALE, children }) {
  const [locale, setLocaleState] = useState(() => normalizeLocale(initialLocale));

  const setLocale = useCallback((nextLocale) => {
    const next = normalizeLocale(nextLocale);
    setLocaleState(next);
    document.cookie = `${LOCALE_COOKIE}=${next}; Max-Age=31536000; Path=/; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    document.documentElement.lang = LOCALE_META[next].html;
    window.dispatchEvent(new CustomEvent("travel-plan:locale-change", { detail: { locale: next } }));
  }, []);

  useEffect(() => {
    document.documentElement.lang = LOCALE_META[locale].html;
  }, [locale]);

  const value = useMemo(() => ({
    locale,
    intlLocale: getIntlLocale(locale),
    locales: SUPPORTED_LOCALES,
    meta: LOCALE_META[locale],
    setLocale,
    t: (key, values) => translate(locale, key, values),
  }), [locale, setLocale]);

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useLocale must be used within LocaleProvider");
  return context;
}
