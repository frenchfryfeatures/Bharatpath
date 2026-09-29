"use client";

import { useState } from "react";
import Link from "next/link";
import { Mail, MapPin, User } from "lucide-react";

import { AppSelect } from "@/components/ui/app-select";
import { getApiErrorMessage } from "@/lib/api/error-message";
import { ApiError } from "@/lib/api/errors";
import { showSuccessFeedback } from "@/lib/feedback/success-feedback";
import { authService } from "@/features/auth/services/auth.service";
import type { SignupResponse } from "@/features/auth/types";
import {
  useUpdateStudentLocationMutation,
  useUpdateStudentNameMutation,
} from "@/store/student";

import { INDIAN_STATES } from "../constants";
import {
  ErrorNote,
  Field,
  fieldBorder,
  fieldClass,
  LockNote,
  PillButton,
  StepHeader,
} from "./ui";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* -------------------------------------------------------------------------
 * 13 Create account - by email (the client has deferred phone OTP and SMS).
 * ---------------------------------------------------------------------- */
interface AccountStepProps {
  onBack: () => void;
  onSignedUp: (result: SignupResponse, email: string) => Promise<void>;
}

export function AccountStep({ onBack, onSignedUp }: Readonly<AccountStepProps>) {
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);
    setExisting(false);

    const value = email.trim();
    if (!EMAIL_PATTERN.test(value)) {
      setFieldError("Enter a valid email address.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await authService.signupCandidate(value);
      showSuccessFeedback("Your account is ready.");
      await onSignedUp(result, value);
    } catch (error) {
      setExisting(error instanceof ApiError && error.status === 409);
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
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <StepHeader
        step="account"
        title="Your email address"
        subtitle="We'll use it to sign you in and to tell you when your score is ready."
      />

      {serverError && (
        <ErrorNote
          action={
            existing ? (
              <Link
                href={`/login?email=${encodeURIComponent(email.trim())}`}
                className="w-fit font-semibold text-[#0A1931] underline underline-offset-2 transition-colors hover:text-[#5F4DB2]"
              >
                Sign in instead
              </Link>
            ) : null
          }
        >
          {serverError}
        </ErrorNote>
      )}

      <Field id="signup-email" label="Email" error={fieldError}>
        <div className="relative">
          <Mail
            className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
            aria-hidden="true"
          />
          <input
            id="signup-email"
            type="email"
            autoComplete="email"
            autoFocus
            placeholder="you@example.com"
            value={email}
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? "signup-email-error" : undefined}
            onChange={(event) => {
              setEmail(event.target.value);
              setFieldError(undefined);
            }}
            className={`${fieldClass} ${fieldBorder(Boolean(fieldError))} pl-12 text-[17px] font-semibold`}
          />
        </div>
      </Field>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          <PillButton variant="secondary" onClick={onBack} className="flex-1">
            Back
          </PillButton>
          <PillButton type="submit" isLoading={submitting} className="flex-[2]">
            {submitting ? "Creating your account…" : "Continue"}
          </PillButton>
        </div>
        <p className="m-0 text-center text-[12px] leading-4 text-[#5F6B80]">
          Started before? Use the same email to pick up where you left off.
        </p>
      </div>
    </form>
  );
}

/* -------------------------------------------------------------------------
 * About you - name (asked at sign-up, blockers E13) and declared location.
 * ---------------------------------------------------------------------- */
const NAME_PATTERN = /^[\p{L}\p{M} .'-]+$/u;
const HAS_LETTER = /\p{L}/u;

function nameError(value: string): string | undefined {
  const name = value.split(/\s+/).join(" ").trim();
  if (!name) return "Enter your name.";
  if (name.length > 200) return "Use 200 characters or fewer.";
  if (!NAME_PATTERN.test(name) || !HAS_LETTER.test(name)) {
    return "Use letters, spaces and . ' - only.";
  }
  return undefined;
}

function cityError(value: string): string | undefined {
  const city = value.split(/\s+/).join(" ").trim();
  if (!city) return undefined;
  if (city.length > 100) return "Use 100 characters or fewer.";
  if (!NAME_PATTERN.test(city) || !HAS_LETTER.test(city)) {
    return "A city is letters, spaces and . ' - only.";
  }
  return undefined;
}

interface AboutStepProps {
  initial: { fullName: string; city: string; stateCode: string };
  onBack?: () => void;
  onDone: () => void;
}

const selectClass =
  "[&>button]:h-[54px] [&>button]:rounded-[16px] [&>button]:border-[1.5px] [&>button]:border-[#E7E0D4] [&>button]:bg-white [&>button]:px-4 [&>button>span]:text-[16px] [&>button>span]:font-medium [&>button>span]:text-[#0A1931] [&_[role=option]]:text-[13px]";

export function AboutStep({ initial, onBack, onDone }: Readonly<AboutStepProps>) {
  const [fullName, setFullName] = useState(initial.fullName);
  const [city, setCity] = useState(initial.city);
  const [stateCode, setStateCode] = useState(initial.stateCode);
  const [errors, setErrors] = useState<{ fullName?: string; city?: string }>({});
  const [serverError, setServerError] = useState<unknown>(null);

  const [saveName, nameState] = useUpdateStudentNameMutation();
  const [saveLocation, locationState] = useUpdateStudentLocationMutation();
  const saving = nameState.isLoading || locationState.isLoading;

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setServerError(null);

    const nextErrors = { fullName: nameError(fullName), city: cityError(city) };
    setErrors(nextErrors);
    if (nextErrors.fullName || nextErrors.city) return;

    try {
      await saveName(fullName.split(/\s+/).join(" ").trim()).unwrap();
      const trimmedCity = city.split(/\s+/).join(" ").trim();
      if (trimmedCity || stateCode || initial.city || initial.stateCode) {
        await saveLocation({
          city: trimmedCity || null,
          stateCode: stateCode || null,
        }).unwrap();
      }
      showSuccessFeedback("Your details are saved.");
      onDone();
    } catch (error) {
      setServerError(error);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-6">
      <StepHeader
        step="about"
        title="A little about you"
        subtitle="Your name is shown to an employer only after you apply. Your city helps employers near you find you."
      />

      {serverError ? (
        <ErrorNote>
          {getApiErrorMessage(serverError, "We could not save your details. Please try again.")}
        </ErrorNote>
      ) : null}

      <Field id="signup-name" label="Full name" hint="As it appears on your resume." error={errors.fullName}>
        <div className="relative">
          <User
            className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
            aria-hidden="true"
          />
          <input
            id="signup-name"
            autoComplete="name"
            autoFocus
            placeholder="e.g. Priya Deshmukh"
            value={fullName}
            maxLength={200}
            aria-invalid={Boolean(errors.fullName)}
            onChange={(event) => {
              setFullName(event.target.value);
              setErrors((current) => ({ ...current, fullName: undefined }));
            }}
            className={`${fieldClass} ${fieldBorder(Boolean(errors.fullName))} pl-12`}
          />
        </div>
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field id="signup-city" label="City or town" optional error={errors.city}>
          <div className="relative">
            <MapPin
              className="pointer-events-none absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-[#3A4761]"
              aria-hidden="true"
            />
            <input
              id="signup-city"
              autoComplete="address-level2"
              placeholder="e.g. Pune"
              value={city}
              maxLength={100}
              aria-invalid={Boolean(errors.city)}
              onChange={(event) => {
                setCity(event.target.value);
                setErrors((current) => ({ ...current, city: undefined }));
              }}
              className={`${fieldClass} ${fieldBorder(Boolean(errors.city))} pl-12`}
            />
          </div>
        </Field>

        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] font-semibold text-[#0A1931]">
            State
            <span className="ml-1.5 font-normal text-[#5F6B80]">Optional</span>
          </span>
          <AppSelect
            value={stateCode}
            onChange={setStateCode}
            options={[
              { value: "", label: "Select a state" },
              ...INDIAN_STATES.map((state) => ({ value: state.code, label: state.name })),
            ]}
            placeholder="Select a state"
            ariaLabel="State"
            className={selectClass}
            searchable
            searchPlaceholder="Search states"
          />
        </div>
      </div>

      <p className="m-0 text-[12px] leading-4 text-[#5F6B80]">
        Just the city — never your address or PIN code.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex gap-2">
          {onBack && (
            <PillButton variant="secondary" onClick={onBack} className="flex-1">
              Back
            </PillButton>
          )}
          <PillButton type="submit" isLoading={saving} className="flex-[2]">
            Continue
          </PillButton>
        </div>
        <LockNote>Only used to build your profile</LockNote>
      </div>
    </form>
  );
}
