import type { Metadata } from "next";

import { AuthChooser } from "@/components/auth-chooser";

export const metadata: Metadata = {
  title: "Create an account",
  description: "Sign up to BharatPath as a candidate, an employer or a college.",
  alternates: { canonical: "/signup/" },
};

export default function SignupPage() {
  return <AuthChooser mode="signup" />;
}
