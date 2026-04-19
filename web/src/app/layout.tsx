import type { Metadata } from "next";
import { Karla, Mukta_Vaani, Radley } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import SiteHeader from "@/components/SiteHeader";
import SiteFooter from "@/components/SiteFooter";
import ChatWidget from "@/components/ChatWidget";
import AccessibilityWidget from "@/components/AccessibilityWidget";
import { getNav, getSiteSettings } from "@/lib/queries";

const karla = Karla({ subsets: ["latin"], variable: "--font-karla", display: "swap" });
const mukta = Mukta_Vaani({ subsets: ["latin"], weight: ["400","500","600","700","800"], variable: "--font-mukta", display: "swap" });
const radley = Radley({ subsets: ["latin"], weight: ["400"], variable: "--font-radley", display: "swap" });

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Brighter Tomorrow Therapy Collective — Las Vegas Therapy",
  description:
    "Las Vegas and North Las Vegas therapy for children, teens, and adults. In-person and online. Evenings and weekends. Compassionate, accessible care.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const headerList = await headers();
  const pathname = headerList.get("x-pathname") ?? "";
  const isAdmin = pathname.startsWith("/admin");

  const fontClasses = `${karla.variable} ${mukta.variable} ${radley.variable}`;

  if (isAdmin) {
    return (
      <html lang="en" className={fontClasses}>
        <body id="top">{children}</body>
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
        <SiteHeader settings={settings} nav={headerNav} />
        <main>{children}</main>
        <SiteFooter settings={settings} nav={footerNav} />
        <ChatWidget />
        <AccessibilityWidget />
      </body>
    </html>
  );
}
