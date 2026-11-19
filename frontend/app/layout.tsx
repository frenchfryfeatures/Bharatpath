import type { Metadata } from "next";
import "./globals.css";
import logo from "@/assets/bharatpath-icon.png";

export const metadata: Metadata = {
  title: {
    default: "BharatPath · Jobs, hiring and campus placements across India",
    template: "%s · BharatPath",
  },
  description:
    "Find work across India, hire from MSME to enterprise, and bring your college's students to employers. One platform for candidates, employers and colleges.",
  icons: {
    icon: logo.src,
    apple: logo.src,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
