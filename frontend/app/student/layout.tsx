import { StudentAppShell } from "@/features/student/shell";
import { StudentOnboardingGate } from "@/features/student/shell/student-onboarding-gate";
import { PortalAccessGuard } from "@/components/auth/portal-access-guard";

export default function StudentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <PortalAccessGuard portal="student">
      <StudentOnboardingGate>
        <StudentAppShell>{children}</StudentAppShell>
      </StudentOnboardingGate>
    </PortalAccessGuard>
  );
}
