import { StudentAppShell } from "@/features/student/shell";
import { StudentOnboardingGate } from "@/features/student/shell/student-onboarding-gate";

export default function StudentLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <StudentOnboardingGate>
      <StudentAppShell>{children}</StudentAppShell>
    </StudentOnboardingGate>
  );
}
