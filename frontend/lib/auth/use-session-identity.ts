"use client";

import { useEffect, useState } from "react";

import { authService } from "@/features/auth/services/auth.service";
import type { AuthUser } from "@/features/auth/types";
import { setUser } from "@/store/common/slices/auth.slice";
import { useAppDispatch, useAppSelector } from "@/store/hooks";

const ROLE_LABELS: Record<string, string> = {
  CANDIDATE: "Student",
  EMPLOYER_OWNER: "Owner",
  EMPLOYER_RECRUITER: "Recruiter",
  EMPLOYER_VIEWER: "View only",
  COLLEGE_ADMIN: "College admin",
  COLLEGE_STAFF: "College staff",
  PLATFORM_ADMIN: "Platform admin",
  KYB_REVIEWER: "KYB reviewer",
  INTEGRITY_REVIEWER: "Integrity reviewer",
  SUPPORT_AGENT: "Support agent",
};

/** A readable label for a backend membership role, or null when unknown. */
export function roleLabel(backendRole: string | undefined): string | null {
  return backendRole ? ROLE_LABELS[backendRole] ?? null : null;
}

/** Up to two initials from a name, or the local part of an email address. */
export function identityInitials(value: string | null | undefined): string {
  const source = (value ?? "").split("@")[0];
  const parts = source.split(/[\s._-]+/).filter(Boolean);
  return (
    parts
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase() || "?"
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** A user-facing name/email, never an internal user or tenant identifier. */
export function identityDisplayLabel(
  user: AuthUser | null,
  fallback: string,
): string {
  for (const value of [user?.name, user?.email]) {
    const label = value?.trim();
    if (label && label !== user?.id && label !== user?.tenantId && !UUID_PATTERN.test(label)) {
      return label;
    }
  }
  return roleLabel(user?.backendRole) ?? fallback;
}

let pending: Promise<boolean> | null = null;

/**
 * Signup stores a provisional user (no membership yet, or no role at all).
 * Once onboarding finishes the membership exists but the slice still holds
 * that provisional user, so it has to be read again from `/auth/me`.
 */
function isProvisional(user: AuthUser | null): boolean {
  return Boolean(user) && (!user?.backendRole || user.backendRole === "NO_ACTIVE_MEMBERSHIP");
}

/**
 * The signed-in person. Sign-in stores them in the auth slice; after a page
 * reload the slice is empty, so it is filled once from the backend's
 * `/auth/me`, resolved from the bearer token kept in localStorage rather
 * than from anything the browser remembered. A provisional user left by
 * signup is re-read once per mount for the same reason. `isResolving` is
 * false once there is an answer either way, so callers never wait on a
 * session that cannot be read.
 */
export function useSessionIdentity(): {
  user: AuthUser | null;
  isResolving: boolean;
} {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const [failed, setFailed] = useState(false);
  const [refreshed, setRefreshed] = useState(false);
  const provisional = isProvisional(user);

  useEffect(() => {
    if (user && (!provisional || refreshed)) {
      return;
    }

    let active = true;
    pending ??= authService
      .me()
      .then((result) => {
        dispatch(setUser({ ...result.user, backendRole: result.backendRole }));
        return true;
      })
      .catch(() => false)
      .finally(() => {
        pending = null;
      });

    void pending.then((resolved) => {
      if (!active) return;
      if (user) setRefreshed(true);
      else if (!resolved) setFailed(true);
    });

    return () => {
      active = false;
    };
  }, [dispatch, user, provisional, refreshed]);

  return { user, isResolving: (!user && !failed) || (provisional && !refreshed) };
}
