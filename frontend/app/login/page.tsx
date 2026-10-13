import { Suspense } from "react";

import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { LoginRouteGuard } from "@/components/auth/login-route-guard";
import { LoginForm } from "@/components/auth/login-form";

export default function LoginPage() {
  return (
    <LoginRouteGuard>
      <AuthPageShell
        eyebrow="Welcome back"
        title="Sign in to BharatPath"
        description="Enter your account email to continue. We'll take you to your candidate, employer, college, or admin portal."
      >
        <Suspense>
          <LoginForm />
        </Suspense>
      </AuthPageShell>
    </LoginRouteGuard>
  );
}
