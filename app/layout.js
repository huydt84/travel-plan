import AssistantProvider from "../components/v1/AssistantProvider";
import { getViewer } from "../lib/auth";
import { resolveAgenticV1Config } from "../lib/v1/config.mjs";
import "../src/styles.css";
import "../components/v1/assistant-motion.css";
import { Barlow_Condensed, Noto_Sans } from "next/font/google";
import ActivityHeartbeat from "../components/ActivityHeartbeat";

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

export const metadata = {
  metadataBase: process.env.APP_URL ? new URL(process.env.APP_URL) : undefined,
  title: "Lịch trình chuyến đi",
  description: "Lịch trình chuyến đi theo thời gian thực.",
  openGraph: {
    title: "Lịch trình chuyến đi",
    description: "Lịch trình chuyến đi theo thời gian thực.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Lịch trình chuyến đi",
    description: "Lịch trình chuyến đi theo thời gian thực.",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#f4f1e8",
};

export default async function RootLayout({ children }) {
  const viewer = resolveAgenticV1Config().enabled ? await getViewer() : null;
  return (
    <html lang="vi" className={`${bodyFont.variable} ${displayFont.variable}`} data-scroll-behavior="smooth">
      <body>
        <AssistantProvider viewer={viewer}>{children}</AssistantProvider>
        <ActivityHeartbeat />
      </body>
    </html>
  );
}
