import type { Metadata } from "next";

import { CollegeSignup } from "@/features/college/onboarding";

export const metadata: Metadata = {
  title: "College sign-up · BharatPath",
};

export default function CollegeSignupPage() {
  return <CollegeSignup />;
}
