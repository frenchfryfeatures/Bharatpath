"use client";

import { useState } from "react";
import { OnboardingBackButton } from "@/components/common/onboarding-back-button";
import Link from "next/link";
import { ArrowRight, KeyRound, Lock, Mail } from "lucide-react";

import { Button, ErrorState } from "@/components/ui";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import {
  passwordError,
  useSignupFlow,
} from "@/features/auth/hooks/use-signup-flow";
import type { SignupResponse } from "@/features/auth/types";

import { FieldError, inputBorder, kybInputClass } from "./kyb-field";
import { StepCard } from "./signup-shell";

const EMtIL_PtTTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface AccountStepCopy {
  title: string;
  description: string;
  successMessage: string;
  emailLabel: string;
  emailPlaceholder: string;
}

const EMPLOYER_COPY: AccountStepCopy = {
  title: "Create your employer account",
  description:
    "Hire from BharatPath's verified candidate pool. Sign up with your work email, set up your organisation, then complete a short business verification (KYB).",
  successMessage: "Your employer account is ready.",
  emailLabel: "Work email",
  emailPlaceholder: "you@yourcompany.in",
};

interface AccountStepProps {
  onSignedUp: (result: SignupResponse, email: string) => void;
  /** Wording for the page; defaults to the employer sign-up. */
  copy?: AccountStepCopy;
}

export type { AccountStepCopy };

export function AccountStep({
  onSignedUp,
  copy = EMPLOYER_COPY,
}: Readonly<AccountStepProps>) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [code, setCode] = useState("");
  const [errors, setErrors] = useState<{ email?: string; password?: string; confirmPassword?: string }>({});

  const flow = useSignupFlow("BUSINESS", (session, signedUpEmail) => {
    showSuccessFeedback(copy.successMessage);
    onSignedUp(session, signedUpEmail);
  });

  const submitDetails = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const next = {
      email: EMtIL_PtTTERN.test(email.trim()) ? undefined : "Enter a valid email address.",
      password: passwordError(password),
      confirmPassword: !confirmPassword ? "Confirm your password." : password !== confirmPassword ? "Passwords do not match." : undefined,
    };
    setErrors(next);
    if (next.email || next.password || next.confirmPassword) return;

    void flow.register(email.trim(), password);
  };

  const submitCode = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void flow.confirm(code.trim());
  };

  return (
    <StepCard
      eyebrow="Step 1 · Your account"
      title={copy.title}
      description={copy.description}
    >
      {flow.phase === "DETAILS" && (
        <form onSubmit={submitDetails} noValidate className="max-w-md space-y-5">
          {flow.error && <ErrorState message={flow.error} />}

          {flow.existingAccount && (
            <Link
              href={`/login?email=${encodeURIComponent(email.trim())}`}
              className="inline-flex items-center gap-1 text-sm font-semibold text-[#3566b8] hover:text-[#254f96]"
            >
              Go to sign in
              <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          )}

          <div>
            <label
              htmlFor="signup-email"
              className="mb-1.5 block text-[13px] font-semibold text-[#303747]"
            >
              {copy.emailLabel}
            </label>
            <div className="relative">
              <Mail
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]"
                aria-hidden="true"
              />
              <input
                id="signup-email"
                type="email"
                autoComplete="email"
                placeholder={copy.emailPlaceholder}
                value={email}
                aria-invalid={Boolean(errors.email)}
                aria-describedby={errors.email ? "signup-email-error" : undefined}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setErrors((current) => ({ ...current, email: undefined }));
                }}
                className={`${kybInputClass} ${inputBorder(Boolean(errors.email))} pl-10`}
              />
            </div>
            <FieldError id="signup-email-error" message={errors.email} />
          </div>

          <div>
            <label
              htmlFor="signup-password"
              className="mb-1.5 block text-[13px] font-semibold text-[#303747]"
            >
              Password
            </label>
            <div className="relative">
              <Lock
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]"
                aria-hidden="true"
              />
              <input
                id="signup-password"
                type="password"
                autoComplete="new-password"
                placeholder="Choose a strong password"
                value={password}
                aria-invalid={Boolean(errors.password)}
                aria-describedby={
                  errors.password ? "signup-password-error" : "signup-password-help"
                }
                onChange={(event) => {
                  setPassword(event.target.value);
                  setErrors((current) => ({ ...current, password: undefined }));
                }}
                className={`${kybInputClass} ${inputBorder(Boolean(errors.password))} pl-10`}
              />
            </div>
            <FieldError id="signup-password-error" message={errors.password} />
            {!errors.password && (
              <p id="signup-password-help" className="mt-1.5 text-xs leading-5 text-[#7b8493]">
                At least 12 characters, with uppercase, lowercase, a number and a symbol.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="signup-confirm-password" className="mb-1.5 block text-[13px] font-semibold text-[#303747]">Confirm password</label>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]" aria-hidden="true" />
              <input
                id="signup-confirm-password"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirmPassword}
                aria-invalid={Boolean(errors.confirmPassword)}
                aria-describedby={errors.confirmPassword ? "signup-confirm-password-error" : undefined}
                onChange={(event) => { setConfirmPassword(event.target.value); setErrors((current) => ({ ...current, confirmPassword: undefined })); }}
                className={`${kybInputClass} ${inputBorder(Boolean(errors.confirmPassword))} pl-10`}
              />
            </div>
            <FieldError id="signup-confirm-password-error" message={errors.confirmPassword} />
          </div>

          <Button
            type="submit"
            variant="dark"
            size="lg"
            className="w-full"
            isLoading={flow.busy}
            loadingText="Creating your account…"
            icon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
            iconPosition="right"
          >
            Continue
          </Button>

          <p className="text-[11px] leading-5 text-[#8790a0]">
            Looking for a job instead?{" "}
            <Link href="/login" className="font-semibold text-[#3566b8] hover:text-[#254f96]">
              Sign in as a candidate
            </Link>
            .
          </p>
        </form>
      )}

      {flow.phase === "CONFIRM" && (
        <form onSubmit={submitCode} noValidate className="max-w-md space-y-5">
          {flow.error && <ErrorState message={flow.error} />}
          {flow.notice && <p className="text-xs text-green-600">{flow.notice}</p>}

          <div>
            <label
              htmlFor="signup-code"
              className="mb-1.5 block text-[13px] font-semibold text-[#303747]"
            >
              Confirmation code
            </label>
            <div className="relative">
              <KeyRound
                className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9aa2b1]"
                aria-hidden="true"
              />
              <input
                id="signup-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="Code from your email"
                value={code}
                onChange={(event) => setCode(event.target.value)}
                className={`${kybInputClass} ${inputBorder(false)} pl-10`}
              />
            </div>
            <p className="mt-1.5 text-xs leading-5 text-[#7b8493]">
              We emailed a code to {flow.email}.
            </p>
          </div>

          <div className="flex gap-2">
            <OnboardingBackButton onClick={flow.back} />
            <Button
              type="button"
              variant="outline"
              size="lg"
              onClick={() => void flow.resend()}
              disabled={flow.busy}
            >
              Resend code
            </Button>
            <Button
              type="submit"
              variant="dark"
              size="lg"
              className="flex-1"
              isLoading={flow.busy}
              loadingText="Confirming…"
              disabled={code.trim().length < 4}
            >
              Confirm
            </Button>
          </div>
        </form>
      )}

    </StepCard>
  );
}
