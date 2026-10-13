"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { FormSkeleton } from "@/components/common/loading";
import { PORTAL_TYPES } from "@/config/portal";
import { AccountStep } from "@/features/employer/onboarding/components/account-step";
import {
  SignupShell,
  StepCard,
  type SignupStep,
} from "@/features/employer/onboarding/components/signup-shell";
import { authService } from "@/features/auth/services/auth.service";
import type { LoginResponse } from "@/features/auth/types";
import { clearStoredToken, setStoredToken } from "@/lib/auth/token";
import { baseApi } from "@/store/api/base-api";
import { clearUser, setUser } from "@/store/common/slices/auth.slice";
import { clearTenant, setTenant } from "@/store/common/slices/tenant.slice";
import { useAppDispatch } from "@/store/hooks";

import { CollegeDetailsWizard } from "./details-wizard";
import { InstitutionStep } from "./institution-step";

type Stage =
  | { name: "booting" }
  | { name: "account" }
  | { name: "institution" }
  | { name: "details" }
  | { name: "blocked"; title: string; message: string; href: string; cta: string };

const ADMIN_ROLE = "COLLEGE_ADMIN";
const NO_MEMBERSHIP = "NO_ACTIVE_MEMBERSHIP";

const ACCOUNT_COPY = {
  title: "Create your college account",
  description:
    "Register your institution on BharatPath. Sign up with your official email, tell us about your institution, then complete a short onboarding form.",
  successMessage: "Your account is ready.",
  emailLabel: "Official email",
  emailPlaceholder: "placement@yourcollege.edu.in",
};

function stageFor(identity: { backendRole: string; path: string }): Stage {
  if (identity.backendRole === ADMIN_ROLE) {
    return { name: "details" };
  }

  if (identity.backendRole === NO_MEMBERSHIP) {
    return { name: "institution" };
  }

  if (identity.backendRole.startsWith("COLLEGE_")) {
    return {
      name: "blocked",
      title: "You are already part of an institution",
      message:
        "Only the institution's administrator can complete onboarding. You can use your dashboard in the meantime.",
      href: "/college",
      cta: "Go to your dashboard",
    };
  }

  return {
    name: "blocked",
    title: "This email already has an account",
    message:
      "It is not a college account, so it cannot be used to register an institution. Sign in with it, or sign up with a different email.",
    href: identity.path || "/login",
    cta: "Go to your account",
  };
}

/**
 * College self-registration: account (business pool), institution
 * (`POST /college/organisation`), then the published onboarding form, one
 * section at a time, and submission.
 */
export function CollegeSignup() {
  const dispatch = useAppDispatch();
  const [stage, setStage] = useState<Stage>({ name: "booting" });
  const [email, setEmail] = useState<string | null>(null);

  const remember = (identity: LoginResponse, knownEmail?: string | null) => {
    dispatch(
      setUser({
        ...identity.user,
        // Keep the typed address while an account has no active membership.
        email: identity.user.email || knownEmail || "",
        name: identity.user.name || knownEmail || "",
        backendRole: identity.backendRole,
      }),
    );
    dispatch(
      setTenant({
        portal: PORTAL_TYPES.COLLEGE,
        tenantId: identity.user.tenantId ?? null,
        tenantSlug: null,
        tenantName: null,
      }),
    );
  };

  // Resume someone who is already signed in (a refresh, a return visit).
  useEffect(() => {
    let cancelled = false;

    authService
      .me()
      .then((identity) => {
        if (cancelled) return;
        if (
          identity.backendRole === ADMIN_ROLE ||
          identity.backendRole === NO_MEMBERSHIP
        ) {
          remember(identity);
          setEmail(identity.user.email || null);
          setStage(stageFor(identity));
        } else {
          setStage({ name: "account" });
        }
      })
      .catch(() => {
        if (!cancelled) setStage({ name: "account" });
      });

    return () => {
      cancelled = true;
    };
    // Runs once on mount; `remember` only dispatches.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const signOut = async () => {
    try {
      await authService.logout();
    } catch {
      /* the token is cleared below anyway */
    }
    clearStoredToken();
    dispatch(clearUser());
    dispatch(clearTenant());
    dispatch(baseApi.util.resetApiState());
    setEmail(null);
    setStage({ name: "account" });
  };

  const accountDone = stage.name !== "account" && stage.name !== "booting";

  const leadingSteps: SignupStep[] = [
    {
      key: "account",
      title: "Your account",
      status: accountDone ? "complete" : "current",
    },
    {
      key: "institution",
      title: "Your institution",
      status:
        stage.name === "details"
          ? "complete"
          : stage.name === "institution"
            ? "current"
            : "upcoming",
    },
  ];

  if (stage.name === "details") {
    return (
      <CollegeDetailsWizard
        leadingSteps={leadingSteps}
        email={email}
        onSignOut={() => void signOut()}
      />
    );
  }

  const placeholderSteps: SignupStep[] = [
    ...leadingSteps,
    { key: "details", title: "Institution details", status: "upcoming" },
  ];

  return (
    <SignupShell
      steps={placeholderSteps}
      signedIn={accountDone}
      email={email}
      subtitle="College sign-up"
      onSignOut={() => void signOut()}
    >
      {stage.name === "booting" && <FormSkeleton fields={2} />}

      {stage.name === "account" && (
        <AccountStep
          portal="college"
          copy={ACCOUNT_COPY}
          onSignedUp={(result, signedUpEmail) => {
            if (result.token) {
              setStoredToken(result.token);
            }
            // A different person may have been signed in; drop their cache.
            dispatch(baseApi.util.resetApiState());
            remember(result, signedUpEmail);
            setEmail(signedUpEmail);
            setStage(stageFor(result));
          }}
        />
      )}

      {stage.name === "institution" && (
        <InstitutionStep
          onCreated={async () => {
            // The admin membership now exists; read it back for the tenant id.
            const identity = await authService.me();
            remember(identity, email);
            setStage(stageFor(identity));
          }}
        />
      )}

      {stage.name === "blocked" && (
        <StepCard title={stage.title} description={stage.message}>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href={stage.href}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-[#17233a] px-4 text-sm font-semibold text-white transition hover:bg-[#223453]"
            >
              {stage.cta}
            </Link>
            <button
              type="button"
              onClick={() => void signOut()}
              className="inline-flex h-10 cursor-pointer items-center justify-center rounded-lg border border-[#dfe2e8] bg-white px-4 text-sm font-semibold text-[#303747] transition hover:bg-[#f8f9fb]"
            >
              Use a different email
            </button>
          </div>
        </StepCard>
      )}
    </SignupShell>
  );
}
