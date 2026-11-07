import type { Metadata } from "next";

import { AuthChooser } from "@/components/auth-chooser";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to BharatPath as a candidate, an employer or a college.",
  alternates: { canonical: "/login/" },
};

export default function LoginPage() {
  return <AuthChooser mode="login" />;
}
