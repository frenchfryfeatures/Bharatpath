import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AuthHandoff } from "@/components/auth-handoff";
import { AUDIENCE_COPY } from "@/content/audiences";
import { AUDIENCES, type Audience } from "@/lib/site";

/** Exactly three pages: student, employer, college. No admin page is generated. */
export const dynamicParams = false;

export function generateStaticParams() {
  return AUDIENCES.map((role) => ({ role }));
}

export async function generateMetadata({ params }: PageProps<"/signup/[role]">): Promise<Metadata> {
  const { role } = await params;
  const copy = AUDIENCE_COPY[role as Audience];
  if (!copy) return {};
  return {
    title: copy.signUpTitle,
    description: copy.signUpLead,
    alternates: { canonical: `/signup/${role}/` },
  };
}

export default async function Page({ params }: PageProps<"/signup/[role]">) {
  const { role } = await params;
  const copy = AUDIENCE_COPY[role as Audience];
  if (!copy) notFound();
  return <AuthHandoff copy={copy} mode="signup" />;
}
