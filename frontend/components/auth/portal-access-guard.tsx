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

  // A business account with no organisation yet (it left sign-up after
  // verifying its email) has no dashboard: every call answers 403. Its next
  // step is creating the organisation, in the sign-up for the portal it
  // opened -- nothing else says whether it meant an employer or a college.
  const needsOrganisation =
    (portal === "employer" || portal === "college") &&
    user?.role !== "STUDENT" &&
    user?.backendRole === "NO_ACTIVE_MEMBERSHIP";

  useEffect(() => {
    if (isPublic || isResolving) return;
    if (needsOrganisation) {
      router.replace(`/signup/${portal}`);
      return;
    }
    if (allowed) return;
    router.replace(user ? homeForUser(user) : "/login");
  }, [allowed, isPublic, isResolving, needsOrganisation, portal, router, user]);

  if (isPublic) return <>{children}</>;
  if (!allowed || needsOrganisation) return <AccountDestinationLoading portal={portal} />;
  return <>{children}</>;
}
