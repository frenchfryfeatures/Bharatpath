"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { handleSessionExpired, isSessionExpired, subscribeSessionExpired, redirectAfterSessionExpired } from "@/lib/auth/handle-session-expired";
import { Modal } from "@/components/ui/modal";
import { isPublicAuthPath } from "@/lib/auth/session-routes";
import { REFRESH_LEEWAY_MS, isTokenFresh, refreshSession } from "@/lib/auth/refresh-session";
import { getStoredToken } from "@/lib/auth/token";
import { getTokenExpiration } from "@/lib/auth/token-expiration";
import { clearUser } from "@/store/common/slices/auth.slice";
import { clearTenant } from "@/store/common/slices/tenant.slice";
import { useAppDispatch } from "@/store/hooks";

const MAX_TIMEOUT = 2_147_483_647;
const RETRY_MS = 30_000;

export function SessionGuard() {
  const pathname = usePathname();
  const router = useRouter();
  const dispatch = useAppDispatch();
  const expired = useSyncExternalStore(subscribeSessionExpired, isSessionExpired, () => false);
  const [redirecting, setRedirecting] = useState(false);

  useEffect(() => {
    if (isPublicAuthPath(pathname)) {
      return;
    }

    let timeoutId: number | undefined;
    let cancelled = false;

    const schedule = (delay: number) => {
      timeoutId = window.setTimeout(
        () => void checkSession(),
        Math.min(Math.max(delay, 1_000), MAX_TIMEOUT),
      );
    };

    const checkSession = async () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      if (isSessionExpired()) return;

      const token = getStoredToken();
      const expiration = token ? getTokenExpiration(token) : null;

      if (!token) {
        dispatch(clearUser());
        dispatch(clearTenant());
        router.replace("/login");
        return;
      }

      if (!expiration) {
        handleSessionExpired();
        return;
      }

      // Renew shortly before the access token lapses. The refresh token lasts
      // 30 days, so only Cognito refusing it ends the session.
      const remaining = expiration * 1000 - Date.now() - REFRESH_LEEWAY_MS;
      if (remaining > 0) {
        schedule(remaining);
        return;
      }

      const result = await refreshSession(true);
      if (cancelled || isSessionExpired()) return;

      if (result.status === "EXPIRED") {
        handleSessionExpired();
      } else if (result.status === "OK" && isTokenFresh(result.token)) {
        void checkSession();
      } else {
        // Offline or Cognito unreachable: keep the session and try again.
        schedule(RETRY_MS);
      }
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void checkSession();
      }
    };

    void checkSession();
    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("storage", handleVisibilityChange);
    window.addEventListener("online", handleVisibilityChange);

    return () => {
      cancelled = true;
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("storage", handleVisibilityChange);
      window.removeEventListener("online", handleVisibilityChange);
    };
  }, [dispatch, pathname, router]);

  return (
    <Modal open={expired} title="Your session has expired" description="Please sign in again to continue." onClose={() => {}} closeDisabled panelClassName="max-w-[420px] rounded-[20px]">
      <button type="button" disabled={redirecting} onClick={() => {
        setRedirecting(true);
        dispatch(clearUser());
        dispatch(clearTenant());
        void redirectAfterSessionExpired();
      }} className="w-full rounded-xl bg-[#5F4DB2] px-4 py-3 text-sm font-semibold text-white hover:bg-[#4A3E8F] disabled:opacity-60">
        {redirecting ? "Opening login..." : "Go to login"}
      </button>
    </Modal>
  );
}
