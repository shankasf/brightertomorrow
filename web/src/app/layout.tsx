import type { Metadata, Viewport } from "next";
import { Karla, Mukta_Vaani, Radley } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ChatWidget from "@/components/ChatWidget";
import AccessibilityWidget from "@/components/AccessibilityWidget";
import TherapistPopup from "@/components/TherapistPopup";
import { LoggerInit } from "@/components/LoggerInit";
import GoogleAnalytics from "@/components/GoogleAnalytics";
import { getNav, getSiteSettings } from "@/lib/queries";
import { SITE_URL, IS_CANONICAL_HOST, SITE_NAME, TITLE_SUFFIX, DEFAULT_OG_IMAGE } from "@/lib/seo";

// Fonts mirrored from brightertomorrowtherapy.com:
//   Karla       — headings, eyebrows, buttons
//   Mukta Vaani — body
//   Radley      — italic accent
const karla = Karla({ subsets: ["latin"], variable: "--font-karla", display: "swap" });
const mukta = Mukta_Vaani({
  subsets: ["latin"],
  weight: ["200","300","400","500","600","700","800"],
  variable: "--font-mukta",
  display: "swap",
});
const radley = Radley({ subsets: ["latin"], weight: ["400"], variable: "--font-radley", display: "swap" });

export const revalidate = 300;

const DEFAULT_TITLE = `${SITE_NAME} — Las Vegas Therapy`;
const DEFAULT_DESCRIPTION =
  "Las Vegas and North Las Vegas therapy for children, teens, and adults. In-person and online. Evenings and weekends. Compassionate, accessible care.";

// generateMetadata (not a static `metadata` const) so SITE_URL, metadataBase,
// and the robots policy are resolved at RUNTIME — the same standalone image
// serves the .cloud preview (noindex) and the canonical .com (indexable).
export function generateMetadata(): Metadata {
  return {
    metadataBase: new URL(SITE_URL),
    title: {
      // Pages that set a string title (via pageMetadata) bypass this template
      // and append the suffix themselves; pages that set only a short title
      // get the suffix from here. `default` covers pages with no title.
      default: DEFAULT_TITLE,
      template: `%s ${TITLE_SUFFIX}`,
    },
    description: DEFAULT_DESCRIPTION,
    // Block indexing on every non-canonical host (e.g. the .cloud preview) so
    // the WordPress→Next cutover doesn't leak duplicate previews into search.
    robots: IS_CANONICAL_HOST
      ? { index: true, follow: true }
      : { index: false, follow: false },
    openGraph: {
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      url: "/",
      siteName: SITE_NAME,
      type: "website",
      locale: "en_US",
      images: [{ url: DEFAULT_OG_IMAGE }],
    },
    twitter: {
      card: "summary_large_image",
      title: DEFAULT_TITLE,
      description: DEFAULT_DESCRIPTION,
      images: [DEFAULT_OG_IMAGE],
    },
  };
}

// viewport-fit=cover unlocks env(safe-area-inset-*) on notched phones so the
// chat bottom-sheet sits flush against the home indicator without overlap.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#192735",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");

  const fontClasses = `${karla.variable} ${mukta.variable} ${radley.variable}`;

  // GA4 only on the public, canonical production host — never on /admin (handled
  // by the early return below) and never on preview hosts. Read at runtime so a
  // missing/unset Measurement ID is a no-op until the secret is provided.
  const gaMeasurementId =
    IS_CANONICAL_HOST && !isAdmin ? (process.env.GA4_MEASUREMENT_ID ?? "") : "";

  if (isAdmin) {
    return (
      <html lang="en" className={fontClasses}>
        <body id="top">
          <LoggerInit />
          {children}
        </body>
      </html>
    );
  }

  const [settings, headerNav, footerNav] = await Promise.all([
    getSiteSettings(),
    getNav("header"),
    getNav("footer"),
  ]);

  return (
    <html lang="en" className={fontClasses}>
      <body id="top">
        <LoggerInit />
        {gaMeasurementId ? <GoogleAnalytics measurementId={gaMeasurementId} /> : null}
        <SiteHeader settings={settings} nav={headerNav} />
        <main>{children}</main>
        <SiteFooter settings={settings} nav={footerNav} />
        <ChatWidget />
        <AccessibilityWidget />
        <TherapistPopup />
      </body>
    </html>
  );
}
