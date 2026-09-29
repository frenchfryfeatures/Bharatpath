"use client";

import Link from "next/link";
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  FileUp,
  Loader2,
  Lock,
  Sparkles,
} from "lucide-react";

import { COUNTED_STEPS, type CountedStep } from "../constants";

/*
 * The candidate sign-up visual language, lifted from the mobile design
 * (cream page, navy ink, violet pill buttons, 20px cards) and laid out for a
 * laptop: the step on the left, a sticky context panel on the right.
 */

/* -------------------------------------------------------------------------
 * Page frame
 * ---------------------------------------------------------------------- */
export type SignupPhase = "start" | "resume" | "review" | "score";

interface SignupFrameProps {
  children: ReactNode;
  /** Which of the three journey phases the aside highlights. */
  phase?: SignupPhase;
  /** Replace the default aside (the welcome screen shows its hero there). */
  aside?: ReactNode;
  signedIn?: boolean;
  onSignOut?: () => void;
}

export function SignupFrame({
  children,
  phase = "start",
  aside,
  signedIn = false,
  onSignOut,
}: Readonly<SignupFrameProps>) {
  return (
    <div className="min-h-screen bg-[#FFFCF7] text-[#0A1931]">
      <header className="sticky top-0 z-30 border-b border-[#F0EBDF] bg-[#FFFCF7]/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5 sm:px-8">
          <Wordmark />
          {signedIn ? (
            onSignOut ? (
              <button
                type="button"
                onClick={onSignOut}
                className="cursor-pointer rounded-full border border-[#DDD6C7] bg-white px-4 py-2 text-[13px] font-semibold text-[#0A1931] transition hover:bg-[#F7F4EC]"
              >
                Sign out
              </button>
            ) : null
          ) : (
            <p className="text-[13px] text-[#5F6B80]">
              Have an account?{" "}
              <Link href="/login" className="font-semibold text-[#5F4DB2] hover:text-[#4A3E8F]">
                Sign in
              </Link>
            </p>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-10 px-5 py-8 sm:px-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-14 lg:py-14">
        <div className="mx-auto w-full max-w-[600px] lg:mx-0">{children}</div>
        <aside className="hidden lg:block">
          <div className="sticky top-28">{aside ?? <JourneyAside phase={phase} />}</div>
        </aside>
      </main>
    </div>
  );
}

export function Wordmark() {
  return (
    <Link href="/signup/student" className="flex items-center gap-2" aria-label="BharatPath">
      <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-[#5F4DB2] text-[15px] font-extrabold text-white">
        B
      </span>
      <span className="text-[20px] font-extrabold tracking-[-0.03em] text-[#05255C]">
        Bharat<span className="text-[#B9891A]">Path</span>
      </span>
    </Link>
  );
}

const JOURNEY: ReadonlyArray<{
  phase: SignupPhase;
  title: string;
  body: string;
  icon: ReactNode;
}> = [
  {
    phase: "resume",
    title: "Give us your resume",
    body: "A file, pasted text, or a short form if you don't have one yet.",
    icon: <FileUp className="h-4 w-4" aria-hidden="true" />,
  },
  {
    phase: "review",
    title: "Check what we read",
    body: "You correct anything wrong before it counts. Nothing is scored behind your back.",
    icon: <ClipboardCheck className="h-4 w-4" aria-hidden="true" />,
  },
  {
    phase: "score",
    title: "Get your score and gaps",
    body: "Five categories, each explained, with the fixes worth the most points.",
    icon: <Sparkles className="h-4 w-4" aria-hidden="true" />,
  },
];

const PHASE_ORDER: SignupPhase[] = ["start", "resume", "review", "score"];

function JourneyAside({ phase }: { phase: SignupPhase }) {
  const current = PHASE_ORDER.indexOf(phase);

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-[24px] bg-[#5E4DB2] p-6 text-white">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-[#E0DBF4]">
          Your path
        </p>
        <p className="mt-2 text-[22px] font-bold leading-[28px] tracking-[-0.02em]">
          Three steps from resume to score.
        </p>
        <ol className="mt-5 flex flex-col gap-3">
          {JOURNEY.map((item) => {
            const index = PHASE_ORDER.indexOf(item.phase);
            const done = index < current;
            const active = index === current;

            return (
              <li
                key={item.phase}
                className={`flex gap-3 rounded-[16px] p-3 transition ${
                  active ? "bg-white/15" : ""
                }`}
              >
                <span
                  className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                    done
                      ? "bg-[#E6F1EA] text-[#1F6B45]"
                      : active
                        ? "bg-[#FFFCF7] text-[#5F4DB2]"
                        : "bg-white/15 text-[#E0DBF4]"
                  }`}
                >
                  {done ? <CheckCircle2 className="h-4 w-4" aria-hidden="true" /> : item.icon}
                </span>
                <span className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold leading-5">{item.title}</span>
                  <span className="text-[13px] leading-[18px] text-[#E0DBF4]">{item.body}</span>
                </span>
              </li>
            );
          })}
        </ol>
      </div>
      <LockNote>Only used to build your profile. Employers see it only if you apply.</LockNote>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Trust panel - what happens to what the candidate gives us.
 * ---------------------------------------------------------------------- */
const PROMISES = [
  "Nothing is scored until you confirm what we read.",
  "Employers see your resume only if you apply.",
  "We never ask your age or date of birth.",
  "Change your language any time from your profile.",
] as const;

export function TrustAside() {
  return (
    <div className="flex flex-col gap-4 rounded-[24px] border border-[#E7E0D4] bg-white p-6">
      <p className="m-0 text-[11px] font-bold uppercase tracking-[0.14em] text-[#5F6B80]">
        Our promise
      </p>
      <p className="m-0 text-[20px] font-bold leading-[26px] tracking-[-0.02em] text-[#0A1931]">
        Your resume stays yours.
      </p>
      <ul className="m-0 flex list-none flex-col gap-3 p-0">
        {PROMISES.map((promise) => (
          <li key={promise} className="flex items-start gap-2.5 text-[14px] leading-5 text-[#3A4761]">
            <span className="mt-0.5">
              <DoneDot />
            </span>
            {promise}
          </li>
        ))}
      </ul>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Step header - "STEP n OF N", segmented bar, title
 * ---------------------------------------------------------------------- */
interface StepHeaderProps {
  step?: CountedStep;
  title: ReactNode;
  subtitle?: ReactNode;
  badge?: ReactNode;
}

export function StepHeader({ step, title, subtitle, badge }: Readonly<StepHeaderProps>) {
  const index = step ? COUNTED_STEPS.indexOf(step) : -1;

  return (
    <div className="flex flex-col gap-2">
      {index >= 0 && (
        <>
          <span className="text-[11px] font-bold uppercase leading-3 tracking-[0.12em] text-[#5F6B80]">
            Step {index + 1} of {COUNTED_STEPS.length}
          </span>
          <div className="flex gap-1.5" aria-hidden="true">
            {COUNTED_STEPS.map((item, position) => (
              <div
                key={item}
                className={`h-1 flex-1 rounded-full ${
                  position <= index ? "bg-[#5F4DB2]" : "bg-[#E7E0D4]"
                }`}
              />
            ))}
          </div>
        </>
      )}
      <div className={`flex flex-col ${index >= 0 ? "mt-2" : ""}`}>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="m-0 text-[28px] font-bold leading-8 tracking-[-0.025em] text-[#0A1931] sm:text-[30px] sm:leading-[34px]">
            {title}
          </h1>
          {badge}
        </div>
        {subtitle && (
          <p className="m-0 mt-1 text-[15px] leading-[22px] text-[#3A4761]">{subtitle}</p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Buttons
 * ---------------------------------------------------------------------- */
type PillVariant = "primary" | "secondary" | "ghost";

interface PillButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: PillVariant;
  isLoading?: boolean;
}

const PILL_VARIANTS: Record<PillVariant, string> = {
  primary: "border-0 bg-[#5F4DB2] text-white hover:bg-[#4A3E8F]",
  secondary: "border border-[#DDD6C7] bg-white text-[#0A1931] hover:bg-[#F7F4EC]",
  ghost: "border-0 bg-transparent text-[#3A4761] hover:text-[#0A1931]",
};

export const PillButton = forwardRef<HTMLButtonElement, PillButtonProps>(
  (
    { variant = "primary", isLoading = false, disabled, className = "", children, type = "button", ...props },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-full px-5 py-4 text-[16px] font-semibold leading-5 transition active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 ${
        variant === "ghost" ? "py-2.5 text-[14px] font-medium" : ""
      } ${PILL_VARIANTS[variant]} ${className}`}
      {...props}
    >
      {isLoading && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
      {children}
    </button>
  ),
);

PillButton.displayName = "PillButton";

/* -------------------------------------------------------------------------
 * Form fields
 * ---------------------------------------------------------------------- */
export const fieldClass =
  "w-full rounded-[16px] border-[1.5px] bg-white px-4 py-3.5 text-[16px] font-medium leading-6 text-[#0A1931] outline-none transition placeholder:font-normal placeholder:text-[#9AA1AE] focus:border-[#0A1931] disabled:bg-[#F7F4EC]";

export function fieldBorder(invalid: boolean): string {
  return invalid ? "border-[#993A22]" : "border-[#E7E0D4]";
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  optional?: boolean;
  children: ReactNode;
}

export function Field({ id, label, hint, error, optional, children }: Readonly<FieldProps>) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-[#0A1931]">
        {label}
        {optional && <span className="ml-1.5 font-normal text-[#5F6B80]">Optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="m-0 text-[12px] font-medium text-[#993A22]">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="m-0 text-[12px] text-[#5F6B80]">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------
 * Notes
 * ---------------------------------------------------------------------- */
export function LockNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center justify-center gap-1.5 text-center text-[12px] leading-4 text-[#5F6B80]">
      <Lock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      {children}
    </p>
  );
}

export function ErrorNote({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-[16px] border border-[#EBC7BA] bg-[#F8E6E0] px-4 py-3 text-[14px] leading-5 text-[#993A22]"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span>{children}</span>
        {action}
      </div>
    </div>
  );
}

export function Card({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-[20px] border border-[#E7E0D4] bg-white ${className}`}>
      {children}
    </div>
  );
}

export function Eyebrow({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="flex items-center gap-2 text-[11px] font-bold uppercase leading-3 tracking-[0.1em] text-[#5F6B80]">
      {icon}
      {children}
    </span>
  );
}

/** A green tick in a 14px circle, as the design marks a finished item. */
export function DoneDot() {
  return (
    <span className="inline-grid h-3.5 w-3.5 shrink-0 place-items-center rounded-full bg-[#1F6B45]">
      <svg viewBox="0 0 12 12" className="h-2 w-2" aria-hidden="true">
        <path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="#E6F1EA" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}
