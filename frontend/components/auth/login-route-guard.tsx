"use client";

import { useEffect, useState, useSyncExternalStore, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { AccountDestinationLoading } from "@/components/common/account-destination-loading";
import { authService } from "@/features/auth/services/auth.service";
import { homeForUser } from "@/lib/auth/route-access";
import { getStoredToken } from "@/lib/auth/token";

function subscribeToStorage(callback: () => void) {
  window.addEventListener("storage", callback);
  return () => window.removeEventListener("storage", callback);
}

export function LoginRouteGuard({ children }: { children: ReactNode }) {
  const router = useRouter();
  const hasToken = useSyncExternalStore(
    subscribeToStorage,
    () => Boolean(getStoredToken()),
    () => null,
  );
  const [allowLogin, setAllowLogin] = useState(false);

  useEffect(() => {
    if (!hasToken) return;

    let active = true;
    void authService.me()
      .then(({ user }) => {
        if (active) router.replace(homeForUser(user));
      })
      .catch(() => {
        // An old or unusable token should not trap the user away from sign-in.
        if (active) setAllowLogin(true);
      });

    return () => {
      active = false;
    };
  }, [hasToken, router]);

  return hasToken === false || allowLogin ? <>{children}</> : <AccountDestinationLoading />;
}
