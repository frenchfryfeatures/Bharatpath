import { notFound, redirect } from "next/navigation";

import { AUDIENCES, type Audience } from "@/lib/site";

export const dynamicParams = false;

export function generateStaticParams() {
  return AUDIENCES.map((role) => ({ role }));
}

export default async function LoginRoleRedirectPage({
  params,
}: {
  params: Promise<{ role: string }>;
}) {
  const { role } = await params;
  if (!AUDIENCES.includes(role as Audience)) {
    notFound();
  }
  redirect(`/login?as=${role}`);
}

