import type { Metadata } from "next";
import "./globals.css";
import logo from "@/assets/Logo.png";
import { SuccessFeedback } from "@/components/common/success-feedback";
import { ReduxProvider } from "@/store/provider";

export const metadata: Metadata = {
  title: "BharatPath",
  description: "BharatPath career and placement platform",
  icons: {
    icon: logo.src,
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
          {children}
          <SuccessFeedback />
        </ReduxProvider>
      </body>
    </html>
  );
}