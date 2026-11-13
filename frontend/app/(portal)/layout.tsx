import { SessionGuard } from "@/components/auth/session-guard";
import { SuccessFeedback } from "@/components/common/success-feedback";
import { ReduxProvider } from "@/store/provider";

export default function PortalGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ReduxProvider>
      <SessionGuard />
      {children}
      <SuccessFeedback />
    </ReduxProvider>
  );
}

