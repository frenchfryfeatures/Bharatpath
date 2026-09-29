import type { Metadata } from "next";

import { StudentSignup } from "@/features/student/onboarding";

export const metadata: Metadata = {
  title: "Sign up · BharatPath",
  description: "Find out how strong your resume is. Free for every candidate.",
};

export default function StudentSignupPage() {
  return <StudentSignup />;
}
