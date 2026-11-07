"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, GraduationCap, UserRound } from "lucide-react";

import { buttonClass } from "@/components/ui";
import type { Audience } from "@/lib/site";

const OPTIONS: { value: Audience; label: string; icon: typeof UserRound; next: string }[] = [
  { value: "student", label: "Candidate", icon: UserRound, next: "Choose a password, confirm your email, then add your CV." },
  { value: "employer", label: "Employer", icon: Building2, next: "Create your business account, then add your organisation." },
  { value: "college", label: "College", icon: GraduationCap, next: "Create your institution account, then set up your college." },
];

/** The closing section: the first screen of sign-up, already open. */
export function CtaOpen({ title = "Start on your path today" }: { title?: string }) {
  const [choice, setChoice] = useState(0);
  const opt = OPTIONS[choice];

  return (
    <section aria-labelledby="cta-heading" className="shell py-10 sm:py-14">
      <div className="grid gap-10 rounded-[28px] bg-lilac px-6 py-12 sm:px-10 lg:grid-cols-2 lg:items-center lg:gap-12 lg:px-14 lg:py-16">
        <div>
          <h2 id="cta-heading" className="max-w-[14ch] text-[36px] font-bold leading-[1.02] tracking-[-0.04em] sm:text-[52px] 2xl:text-[60px]">
            {title}
          </h2>
          <p className="mt-4 max-w-[42ch] text-[17px] text-body">
            One account per person. Candidates, employers and colleges each get their own sign-in and their own space.
          </p>
        </div>

        <div data-ui className="rounded-[24px] bg-paper p-5 shadow-float sm:p-7">
          <p className="text-[19px] font-bold tracking-[-0.02em]">Create your account</p>
          <p className="mt-1 text-[15px] text-muted">Who are you signing up as?</p>
          <div className="mt-5 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Account type">
            {OPTIONS.map(({ icon: Icon, ...o }, i) => (
              <button
                key={o.value}
                type="button"
                role="radio"
                aria-checked={choice === i}
                onClick={() => setChoice(i)}
                className={`flex flex-col items-center gap-2 rounded-2xl border px-2 py-4 text-[14px] font-semibold transition-colors ${
                  choice === i ? "border-purple bg-lavender text-purple-deep" : "border-line text-body hover:bg-sand"
                }`}
              >
                <Icon className="h-5 w-5" aria-hidden="true" />
                {o.label}
              </button>
            ))}
          </div>
          <p className="mt-4 min-h-[48px] text-[15px] text-muted">{opt.next}</p>
          <Link href={`/signup/${opt.value}/`} className={`${buttonClass("primary", "lg")} mt-2 w-full`}>
            Continue as {opt.label.toLowerCase()}
          </Link>
          <p className="mt-4 text-center text-[15px] text-muted">
            Already have an account?{" "}
            <Link href={`/login/${opt.value}/`} className="font-semibold text-purple hover:underline">
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
