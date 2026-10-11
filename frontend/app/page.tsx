"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { homeForUser } from "@/lib/auth/route-access";
import { getStoredToken } from "@/lib/auth/token";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";

/**
 * The base URL sends a signed-in browser straight to its own dashboard and
 * everyone else to the login page. The bearer token lives in localStorage, so
 * this can only be decided on the client.
 */
export default function HomePage() {
  const router = useRouter();
  const [hasToken, setHasToken] = useState<boolean | null>(null);

  useEffect(() => {
    const present = Boolean(getStoredToken());
    setHasToken(present);
    if (!present) router.replace("/login");
  }, [router]);

  return hasToken ? <GoToDashboard /> : null;
}

function GoToDashboard() {
  const router = useRouter();
  const { user, isResolving } = useSessionIdentity();

  useEffect(() => {
    if (isResolving) return;
    router.replace(user ? homeForUser(user) : "/login");
  }, [isResolving, router, user]);

  return null;
}
