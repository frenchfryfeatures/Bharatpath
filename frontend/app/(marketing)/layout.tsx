import type { Metadata, Viewport } from "next";

import { SiteFooter } from "@/components/marketing/site-footer";
import { SiteHeader } from "@/components/marketing/site-header";
import { RevealOnScroll } from "@/components/marketing/reveal-on-scroll";
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
  themeColor: "#5f4db2",
};

export default function MarketingLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="bp-marketing min-h-screen bg-cream text-ink">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-paper focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <SiteHeader />
      <main id="main">{children}</main>
      <SiteFooter />
      <RevealOnScroll />
    </div>
  );
}

