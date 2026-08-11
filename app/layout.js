import "../src/styles.css";

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

const designContract = `
THESIS: The day is one living transit line; refuse the generic travel dashboard of detached rounded cards.
OWN-WORLD: Warm paper, navy station ink, route green, transfer yellow, clipped enamel fascias, timetable rules, and route-node geometry.
STORY: Friends see the whole day, identify the current station, understand the next transfer, and contribute without losing their place.
FIRST VIEWPORT: A slim control band sits above a 30/70 foldout; the route spine fills the left and the active station expands right with countdown and attached next-stop fascia.
FORM: Foldout Spine, approved composition; seed b6766823.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, and DESIGN.md
`;

export default function RootLayout({ children }) {
  return (
    <html lang="vi">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=Noto+Sans:wght@400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>
        <script
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: `document.currentScript.before(document.createComment(${JSON.stringify(designContract)}));` }}
        />
        {children}
      </body>
    </html>
  );
}
