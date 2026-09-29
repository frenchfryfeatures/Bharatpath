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

let pending: Promise<boolean> | null = null;

/**
 * The signed-in person. Sign-in stores them in the auth slice; after a page
 * reload the slice is empty, so it is filled once from `/api/auth/me`, which
 * resolves the identity from the session cookie rather than from anything
 * the browser remembered. `isResolving` is false once there is an answer
 * either way, so callers never wait on a session that cannot be read.
 */
export function useSessionIdentity(): {
  user: AuthUser | null;
  isResolving: boolean;
} {
  const dispatch = useAppDispatch();
  const user = useAppSelector((state) => state.auth.user);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (user) {
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
      if (active && !resolved) {
        setFailed(true);
      }
    });

    return () => {
      active = false;
    };
  }, [dispatch, user]);

  return { user, isResolving: !user && !failed };
}
