import { cookies } from "next/headers";
import { LOCALE_COOKIE, normalizeLocale, translate } from "./i18n.mjs";

export async function localizedMetadata(titleKey) {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return { title: translate(locale, titleKey) };
}
