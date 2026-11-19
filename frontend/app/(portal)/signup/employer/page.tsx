import type { Metadata } from "next";

import { EmployerSignup } from "@/features/employer/onboarding";

export const metadata: Metadata = {
  title: "Employer sign-up · BharatPath",
};

export default function EmployerSignupPage() {
  return <EmployerSignup />;
}
