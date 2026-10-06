import type { Metadata } from "next";
import "./globals.css";
import logo from "@/assets/bharatpath-icon.png";
import { SessionGuard } from "@/components/auth/session-guard";
import { SuccessFeedback } from "@/components/common/success-feedback";
import { ReduxProvider } from "@/store/provider";

export const metadata: Metadata = {
  title: "BharatPath",
  description: "BharatPath career and placement platform",
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
    <html lang="en">
      <body>
        <ReduxProvider>
          <SessionGuard />
          {children}
          <SuccessFeedback />
        </ReduxProvider>
      </body>
    </html>
  );
}