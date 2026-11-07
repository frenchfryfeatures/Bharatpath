"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Mail } from "lucide-react";

import { AppBadges } from "@/components/app-badges";
import type { AudienceCopy } from "@/content/audiences";
import { portalLoginUrl, portalSignupUrl } from "@/lib/site";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One audience's own sign-in or sign-up page. Credentials are never typed
 * into the website: sign-in takes the email and hands over to the portal's
 * sign-in, locked to this audience (`?as=`), where the password is entered.
 * Sign-up goes straight to the portal's own flow for that audience.
 */
export function AuthHandoff({ copy, mode }: { copy: AudienceCopy; mode: "login" | "signup" }) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const signIn = mode === "login";

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const value = email.trim();
    if (value && !EMAIL.test(value)) {
      setError("That does not look like an email address. Check it and try again.");
      return;
    }
    window.location.assign(portalLoginUrl(copy.slug, value || undefined));
  };

  const others = (["student", "employer", "college"] as const).filter((a) => a !== copy.slug);

  return (
    <section className="shell pt-4 sm:pt-6">
      <div className="grid overflow-hidden rounded-[28px] lg:min-h-[78svh] lg:grid-cols-2">
        <div className="flex flex-col justify-between gap-10 bg-purple px-5 py-10 text-white sm:px-10 lg:px-12 lg:py-14">
          <p className="text-[15px] text-white/75">{copy.name}</p>
          <div>
            <h1 className="max-w-[18ch] text-[clamp(34px,4vw,56px)] font-bold leading-[1.04] tracking-[-0.035em]">
              {signIn ? copy.signInTitle : copy.signUpTitle}
            </h1>
            <ul className="mt-8 space-y-3">
              {copy.points.map((p) => (
                <li key={p} className="flex items-start gap-3 text-[16px] text-white/75">
                  <Check className="mt-1 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                  {p}
                </li>
              ))}
            </ul>
          </div>
          {copy.slug === "student" && (
            <div>
              <p className="mb-3 text-[15px] text-white/75">Or use the app</p>
              <AppBadges tone="light" />
            </div>
          )}
        </div>

        <div className="flex items-center bg-sand px-5 py-12 sm:px-10 lg:px-16">
          <div className="w-full max-w-[440px]">
            {signIn ? (
              <form onSubmit={onSubmit} noValidate data-ui className="rounded-[24px] bg-paper p-6 sm:p-8">
                <p className="text-[20px] font-semibold tracking-[-0.01em]">Sign in</p>
                <p className="mt-1 text-[14px] text-muted">{copy.signInLead}</p>
                <label htmlFor="email" className="mt-6 block text-[14px] font-medium">
                  Email address
                </label>
                <div className="mt-1.5 flex items-center gap-2 rounded-[24px] border border-line px-3 focus-within:border-purple">
                  <Mail className="h-4 w-4 text-muted" aria-hidden="true" />
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    inputMode="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setError("");
                    }}
                    placeholder={copy.emailPlaceholder}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "email-error" : "email-hint"}
                    className="h-12 w-full bg-transparent text-[15px] outline-none placeholder:text-muted/80"
                  />
                </div>
                {error ? (
                  <p id="email-error" className="mt-2 text-[14px] text-[#a32020]">
                    {error}
                  </p>
                ) : (
                  <p id="email-hint" className="mt-2 text-[13px] text-muted">
                    You enter your password on the next screen, on our secure sign-in.
                  </p>
                )}
                <button type="submit" className="mt-6 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-purple text-[15px] font-medium text-white transition-colors hover:bg-purple-deep">
                  Continue <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </button>
                <p className="mt-5 text-center text-[14px] text-muted">
                  New here?{" "}
                  <Link href={`/signup/${copy.slug}/`} className="font-medium text-purple hover:underline">
                    Create an account
                  </Link>
                </p>
              </form>
            ) : (
              <div data-ui className="rounded-[24px] bg-paper p-6 sm:p-8">
                <p className="text-[20px] font-semibold tracking-[-0.01em]">Sign up</p>
                <p className="mt-1 text-[14px] text-muted">{copy.signUpLead}</p>
                <ol className="mt-6 space-y-3 text-[14px]">
                  {[
                    "Enter your email and choose a password",
                    "Confirm the code we email you",
                    copy.slug === "student" ? "Add your CV, or build one" : copy.slug === "employer" ? "Add your organisation and post a role" : "Set up your college and invite students",
                  ].map((s, i) => (
                    <li key={s} className="flex items-center gap-3">
                      <span className="tabular flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-sand text-[13px] font-semibold">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                <a
                  href={portalSignupUrl(copy.slug)}
                  className="mt-7 flex h-[52px] w-full items-center justify-center gap-2 rounded-full bg-purple text-[15px] font-medium text-white transition-colors hover:bg-purple-deep"
                >
                  Create account <ArrowRight className="h-4 w-4" aria-hidden="true" />
                </a>
                <p className="mt-5 text-center text-[14px] text-muted">
                  Already registered?{" "}
                  <Link href={`/login/${copy.slug}/`} className="font-medium text-purple hover:underline">
                    Sign in
                  </Link>
                </p>
              </div>
            )}
            <p className="mt-6 text-[14px] text-muted">
              Not {copy.slug === "student" ? "a candidate" : copy.slug === "employer" ? "an employer" : "a college"}?{" "}
              {others.map((o, i) => (
                <span key={o}>
                  {i > 0 && " or "}
                  <Link href={`/${mode}/${o}/`} className="font-medium text-purple hover:underline">
                    {o === "student" ? "candidate" : o} {signIn ? "sign in" : "sign up"}
                  </Link>
                </span>
              ))}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
