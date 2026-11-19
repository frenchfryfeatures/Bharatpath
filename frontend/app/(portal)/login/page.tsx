import { Suspense } from "react";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <AuthPageShell
      eyebrow="Welcome back"
      title="Sign in to BharatPath"
      description="Enter your account email to continue. We'll take you straight to your portal."
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
