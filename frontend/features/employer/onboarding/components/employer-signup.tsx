"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { FormSkeleton } from "@/components/common/loading";
import { PORTAL_TYPES, type PortalType } from "@/config/portal";
import { authService } from "@/features/auth/services/auth.service";
import type { LoginResponse } from "@/features/auth/types";
import { clearStoredToken, setStoredToken } from "@/lib/auth/token";
import { baseApi } from "@/store/api/base-api";
import { clearUser, setUser } from "@/store/common/slices/auth.slice";
import { clearTenant, setTenant } from "@/store/common/slices/tenant.slice";
import { useAppDispatch } from "@/store/hooks";

import { AccountStep } from "./account-step";
import { KybWizard } from "./kyb-wizard";
import { OrganisationStep } from "./organisation-step";
import { SignupShell, StepCard, type SignupStep } from "./signup-shell";

type Stage =
  | { name: "booting" }
  | { name: "account" }
  | { name: "organisation" }
  | { name: "kyb" }
  | { name: "blocked"; title: string; message: string; href: string; cta: string };

const OWNER_ROLE = "EMPLOYER_OWNER";

function stageFor(identity: { backendRole: string; path: string }): Stage {
  if (identity.backendRole === OWNER_ROLE) {
    return { name: "kyb" };
  }

  if (identity.backendRole.startsWith("EMPLOYER_")) {
    return {
      name: "blocked",
      title: "You're already part of an organisation",
      message:
        "Only the organisation's owner can complete business verification. You can use your dashboard in the meantime.",
      href: "/employer",
      cta: "Go to your dashboard",
    };
  }

  return {
    name: "blocked",
    title: "This email already has an account",
    message:
      "It is not an employer account, so it cannot be used to register an organisation. Sign in with it, or sign up with a different email.",
    href: identity.path || "/login",
    cta: "Go to your account",
  };
}

/**
 * Employer self-registration, step by step: account, organisation, then every
 * section of the published KYB form, a review, and submission.
 */
export function EmployerSignup() {
  const dispatch = useAppDispatch();
  const [stage, setStage] = useState<Stage>({ name: "booting" });
  const [email, setEmail] = useState<string | null>(null);

  const remember = (identity: LoginResponse, knownEmail?: string | null) => {
    dispatch(
      setUser({
        ...identity.user,
        // `/auth/me` does not return an email; keep the one we signed up with.
        email: identity.user.email || knownEmail || "",
        name: identity.user.name || knownEmail || "",
      }),
    );
    const portals: readonly string[] = Object.values(PORTAL_TYPES);

    dispatch(
      setTenant({
        portal: portals.includes(identity.portal)
          ? (identity.portal as PortalType)
          : PORTAL_TYPES.EMPLOYER,
        tenantId: identity.user.tenantId ?? null,
        tenantSlug: null,
        tenantName: null,
      }),
    );
  };

  // Resume an owner who is already signed in (a refresh, a return visit).
  useEffect(() => {
    let cancelled = false;

    authService
      .me()
      .then((identity) => {
        if (cancelled) return;
        if (identity.backendRole === OWNER_ROLE) {
          remember(identity);
          setEmail(identity.user.email || null);
          setStage({ name: "kyb" });
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
      /* the cookie is cleared by expiry anyway */
    }
    clearStoredToken();
    dispatch(clearUser());
    dispatch(clearTenant());
    dispatch(baseApi.util.resetApiState());
    setEmail(null);
    setStage({ name: "account" });
  };

  const accountDone = stage.name !== "account" && stage.name !== "booting";
  const organisationDone = stage.name === "kyb";

  const leadingSteps: SignupStep[] = [
    {
      key: "account",
      title: "Your account",
      status: accountDone ? "complete" : "current",
    },
    {
      key: "organisation",
      title: "Your organisation",
      status: organisationDone
        ? "complete"
        : stage.name === "organisation"
          ? "current"
          : "upcoming",
    },
  ];

  const placeholderSteps: SignupStep[] = [
    ...leadingSteps,
    { key: "kyb", title: "Business verification", status: "upcoming" },
    { key: "review", title: "Review & submit", status: "upcoming" },
  ];

  if (stage.name === "kyb") {
    return (
      <KybWizard leadingSteps={leadingSteps} email={email} onSignOut={() => void signOut()} />
    );
  }

  return (
    <SignupShell
      steps={placeholderSteps}
      signedIn={accountDone}
      email={email}
      onSignOut={() => void signOut()}
    >
      {stage.name === "booting" && <FormSkeleton fields={2} />}

      {stage.name === "account" && (
        <AccountStep
          onSignedUp={(result, signedUpEmail) => {
            if (result.token) {
              setStoredToken(result.token);
            }
            // A different person may have been signed in; drop their cache.
            dispatch(baseApi.util.resetApiState());
            remember(result, signedUpEmail);
            setEmail(signedUpEmail);

            if (result.needsOrganisation) {
              setStage({ name: "organisation" });
              return;
            }

            setStage(stageFor(result));
          }}
        />
      )}

      {stage.name === "organisation" && (
        <OrganisationStep
          onCreated={async () => {
            // The owner membership now exists; read it back for the tenant id.
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
