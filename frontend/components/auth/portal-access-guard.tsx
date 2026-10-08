"use client";

import { useEffect, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";

import { AccountDestinationLoading } from "@/components/common/account-destination-loading";
import { canAccessPortalPath, homeForUser, type ProtectedPortal } from "@/lib/auth/route-access";
import { isPublicAuthPath } from "@/lib/auth/session-routes";
import { useSessionIdentity } from "@/lib/auth/use-session-identity";

export function PortalAccessGuard({ portal, children }: { portal: ProtectedPortal; children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, isResolving } = useSessionIdentity();
  const isPublic = isPublicAuthPath(pathname);
  const allowed = Boolean(user && canAccessPortalPath(user, portal, pathname));

  useEffect(() => {
    if (isPublic || isResolving || allowed) return;
    router.replace(user ? homeForUser(user) : "/login");
  }, [allowed, isPublic, isResolving, router, user]);

  if (isPublic) return <>{children}</>;
  if (!allowed) return <AccountDestinationLoading />;
  return <>{children}</>;
}
