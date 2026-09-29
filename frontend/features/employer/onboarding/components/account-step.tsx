"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Mail } from "lucide-react";

import { Button, ErrorState } from "@/components/ui";
import { ApiError } from "@/lib/api/errors";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { authService } from "@/features/auth/services/auth.service";
import type { SignupResponse } from "@/features/auth/types";

import { FieldError, inputBorder, kybInputClass } from "./kyb-field";
import { StepCard } from "./signup-shell";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

interface AccountStepProps {
  onSignedUp: (result: SignupResponse, email: string) => void;
}

export function AccountStep({ onSignedUp }: Readonly<AccountStepProps>) {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [existingAccount, setExistingAccount] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    setExistingAccount(false);

    const value = email.trim();

    if (!EMAIL_PATTERN.test(value)) {
      setFieldError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);

    try {
      const result = await authService.signupEmployer({ email: value });
      showSuccessFeedback("Your employer account is ready.");
      onSignedUp(result, value);
    } catch (error) {
      setExistingAccount(error instanceof ApiError && error.status === 409);
      setServerError(
        error instanceof Error
          ? error.message
          : "Could not create your account. Please try again.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <StepCard
      eyebrow="Step 1 · Your account"
      title="Create your employer account"
      description="Hire from BharatPath's verified candidate pool. Sign up with your work email, set up your organisation, then complete a short business verification (KYB)."
    >
      <form onSubmit={submit} noValidate className="max-w-md space-y-5">
        {serverError && <ErrorState message={serverError} />}

        {existingAccount && (
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
            Work email
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
              placeholder="you@yourcompany.in"
              value={email}
              aria-invalid={Boolean(fieldError)}
              aria-describedby={fieldError ? "signup-email-error" : "signup-email-help"}
              onChange={(event) => {
                setEmail(event.target.value);
                setFieldError(undefined);
              }}
              className={`${kybInputClass} ${inputBorder(Boolean(fieldError))} pl-10`}
            />
          </div>
          <FieldError id="signup-email-error" message={fieldError} />
          {!fieldError && (
            <p id="signup-email-help" className="mt-1.5 text-xs leading-5 text-[#7b8493]">
              Started before? Enter the same email to continue where you left off.
            </p>
          )}
        </div>

        <Button
          type="submit"
          variant="dark"
          size="lg"
          className="w-full"
          isLoading={submitting}
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
    </StepCard>
  );
}
