import type { Metadata, Viewport } from "next";
import "./globals.css";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { RevealOnScroll } from "@/components/reveal-on-scroll";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: "BharatPath · Jobs, hiring and campus placements across India",
    template: "%s · BharatPath",
  },
  description:
    "Find work across India, hire from MSME to enterprise, and bring your college's students to employers. One platform for candidates, employers and colleges.",
  openGraph: {
    siteName: "BharatPath",
    type: "website",
    locale: "en_IN",
    images: ["/logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b2a6b",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-IN">
      <body>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-[6px] focus:bg-paper focus:px-4 focus:py-2"
        >
          Skip to content
        </a>
        <SiteHeader />
        <main id="main">{children}</main>
        <SiteFooter />
        <RevealOnScroll />
      </body>
    </html>
  );
}
