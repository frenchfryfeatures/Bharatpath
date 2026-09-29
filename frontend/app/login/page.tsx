import { Suspense } from "react";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <AuthPageShell
      eyebrow="Welcome back"
      title="Sign in to BharatPath"
      description="Enter your account email to continue. We'll take you to your candidate, employer, college, or admin portal."
      alternateText="Hiring for your organisation?"
      alternateLabel="Create an employer account"
      alternateHref="/signup/employer"
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
