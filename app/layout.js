import AssistantProvider from "../components/v1/AssistantProvider";
import { getViewer } from "../lib/auth";
import { resolveAgenticV1Config } from "../lib/v1/config.mjs";
import "../src/styles.css";
import "../components/v1/assistant-motion.css";
import { Barlow_Condensed, Noto_Sans } from "next/font/google";
import ActivityHeartbeat from "../components/ActivityHeartbeat";
import { LocaleProvider } from "../components/LocaleProvider";
import { cookies } from "next/headers";
import { LOCALE_COOKIE, LOCALE_META, normalizeLocale, translate } from "../lib/i18n.mjs";

const bodyFont = Noto_Sans({
  subsets: ["latin", "vietnamese"],
  variable: "--font-body",
  display: "swap",
});

const displayFont = Barlow_Condensed({
  subsets: ["latin", "vietnamese"],
  weight: ["500", "600", "700"],
  variable: "--font-display",
  display: "swap",
});

export async function generateMetadata() {
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  const title = translate(locale, "app.title");
  const description = translate(locale, "app.description");
  return { metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined, title, description, openGraph: { title, description, type: "website" }, twitter: { card: "summary_large_image", title, description } };
}

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f1e8",
};

export default async function RootLayout({ children }) {
  const viewer = resolveAgenticV1Config().enabled ? await getViewer() : null;
  const locale = normalizeLocale((await cookies()).get(LOCALE_COOKIE)?.value);
  return (
    <html lang={LOCALE_META[locale].html} className={`${bodyFont.variable} ${displayFont.variable}`} data-scroll-behavior="smooth">
      <body>
        <LocaleProvider initialLocale={locale}>
          <AssistantProvider viewer={viewer}>{children}</AssistantProvider>
        </LocaleProvider>
        <ActivityHeartbeat />
      </body>
    </html>
  );
}
