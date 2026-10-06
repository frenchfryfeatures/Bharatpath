import Link from "next/link";
import { BrandIcon } from "@/components/common/brand-icon";
import { Check, LogOut } from "lucide-react";

export type StepStatus = "complete" | "current" | "upcoming";

export interface SignupStep {
  key: string;
  title: string;
  status: StepStatus;
  /** When set, the step can be revisited by clicking it. */
  onSelect?: () => void;
}

interface SignupShellProps {
  steps: SignupStep[];
  signedIn?: boolean;
  /** The signed-in email, when known. */
  email?: string | null;
  /** The line under the wordmark, e.g. "Employer sign-up". */
  subtitle?: string;
  onSignOut?: () => void;
  children: React.ReactNode;
}

export function SignupShell({
  steps,
  signedIn = false,
  email,
  subtitle = "Employer sign-up",
  onSignOut,
  children,
}: Readonly<SignupShellProps>) {
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.status === "current"),
  );
  const current = steps[currentIndex];
  const progress = steps.length
    ? Math.round(((currentIndex + 1) / steps.length) * 100)
    : 0;

  return (
    <div className="min-h-screen bg-[#f4f7fb]">
      <header className="sticky top-0 z-30 border-b border-[#e1e6ee] bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <Link href="/login" className="flex items-center gap-3">
            <BrandIcon className="h-9 w-9" />
            <span className="leading-tight">
              <span className="block text-sm font-semibold text-[#17233a]">
                BharatPath
              </span>
              <span className="block text-[11px] text-[#687386]">
                {subtitle}
              </span>
            </span>
          </Link>

          {signedIn ? (
            <div className="flex min-w-0 items-center gap-3">
              {email && (
                <span className="hidden truncate text-xs text-[#687386] sm:inline">
                  Signed in as{" "}
                  <span className="font-semibold text-[#17233a]">{email}</span>
                </span>
              )}
              {onSignOut && (
                <button
                  type="button"
                  onClick={onSignOut}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-[#dfe2e8] bg-white px-3 py-1.5 text-xs font-semibold text-[#4f5666] transition hover:bg-[#f8f9fb]"
                >
                  <LogOut className="h-3.5 w-3.5" aria-hidden="true" />
                  Sign out
                </button>
              )}
            </div>
          ) : (
            <p className="text-xs text-[#687386]">
              Already registered?{" "}
              <Link
                href="/login"
                className="font-semibold text-[#3566b8] hover:text-[#254f96]"
              >
                Sign in
              </Link>
            </p>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-6 px-5 py-8 sm:px-8 lg:grid-cols-[260px_minmax(0,1fr)] lg:gap-10 lg:py-12">
        {/* Compact progress for small screens */}
        <div className="lg:hidden">
          <div className="flex items-center justify-between text-xs font-semibold text-[#687386]">
            <span>
              Step {currentIndex + 1} of {steps.length}
            </span>
            <span className="text-[#17233a]">{current?.title}</span>
          </div>
          <div
            className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e1e6ee]"
            role="progressbar"
            aria-valuenow={progress}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Sign-up progress"
          >
            <div
              className="h-full rounded-full bg-[#3566b8] transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>

        <aside className="hidden lg:block">
          <nav
            aria-label="Sign-up steps"
            className="sticky top-24 rounded-2xl border border-[#e1e6ee] bg-white p-5 shadow-[0_1px_2px_rgba(17,24,39,0.03)]"
          >
            <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#8790a0]">
              Your progress
            </p>
            <ol className="space-y-1">
              {steps.map((step, index) => (
                <StepItem
                  key={step.key}
                  step={step}
                  index={index}
                  last={index === steps.length - 1}
                />
              ))}
            </ol>
          </nav>
        </aside>

        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}

function StepItem({
  step,
  index,
  last,
}: {
  step: SignupStep;
  index: number;
  last: boolean;
}) {
  const clickable = step.status !== "current" && Boolean(step.onSelect);

  const marker =
    step.status === "complete" ? (
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#1f8a70] text-white">
        <Check className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    ) : (
      <span
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold ${
          step.status === "current"
            ? "border-[#3566b8] bg-[#3566b8] text-white"
            : "border-[#dfe2e8] bg-white text-[#8790a0]"
        }`}
      >
        {index + 1}
      </span>
    );

  const content = (
    <span className="flex items-center gap-3">
      {marker}
      <span
        className={`text-[13px] leading-5 ${
          step.status === "current"
            ? "font-semibold text-[#17233a]"
            : step.status === "complete"
              ? "font-medium text-[#303747]"
              : "text-[#8790a0]"
        }`}
      >
        {step.title}
      </span>
    </span>
  );

  return (
    <li className="relative">
      {!last && (
        <span
          aria-hidden="true"
          className={`absolute left-[13px] top-9 h-[calc(100%-24px)] w-px ${
            step.status === "complete" ? "bg-[#1f8a70]/40" : "bg-[#e1e6ee]"
          }`}
        />
      )}
      {clickable ? (
        <button
          type="button"
          onClick={step.onSelect}
          className="w-full cursor-pointer rounded-lg px-1 py-1.5 text-left transition hover:bg-[#f4f7fb]"
        >
          {content}
        </button>
      ) : (
        <div
          className="px-1 py-1.5"
          aria-current={step.status === "current" ? "step" : undefined}
        >
          {content}
        </div>
      )}
    </li>
  );
}

interface StepCardProps {
  eyebrow?: string;
  title: string;
  description?: string | null;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function StepCard({
  eyebrow,
  title,
  description,
  children,
  footer,
}: Readonly<StepCardProps>) {
  return (
    <section className="rounded-2xl border border-[#e1e6ee] bg-white shadow-[0_20px_55px_rgba(27,39,61,0.06)]">
      <div className="border-b border-[#eef1f5] px-6 py-5 sm:px-8">
        {eyebrow && (
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#3566b8]">
            {eyebrow}
          </p>
        )}
        <h1 className="mt-1 text-xl font-semibold tracking-[-0.015em] text-[#17233a] sm:text-2xl">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[#687386]">
            {description}
          </p>
        )}
      </div>

      <div className="px-6 py-6 sm:px-8">{children}</div>

      {footer && (
        <div className="flex items-center justify-between gap-3 border-t border-[#eef1f5] px-6 py-4 sm:px-8">
          {footer}
        </div>
      )}
    </section>
  );
}
