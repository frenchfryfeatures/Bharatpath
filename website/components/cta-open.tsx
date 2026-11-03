"use client";

import { useState } from "react";
import Link from "next/link";

import type { Audience } from "@/lib/site";

const OPTIONS: { value: Audience; label: string; next: string }[] = [
  { value: "student", label: "Candidate", next: "Next, you choose a password and confirm your email. Then add your CV." },
  { value: "employer", label: "Employer", next: "Next, you create your business account and add your organisation." },
  { value: "college", label: "College", next: "Next, you create your institution account and set up your college." },
];

/** The closing section: the product's first screen, already open. */
export function CtaOpen({ title = ["Start on", "your path."] }: { title?: [string, string] }) {
  const [choice, setChoice] = useState(0);
  const opt = OPTIONS[choice];

  return (
    <section aria-labelledby="cta-heading" className="px-2 sm:px-3">
      <div className="grid min-h-[78svh] gap-10 rounded-[6px] bg-saffron px-5 py-12 sm:px-10 lg:grid-cols-12 lg:items-center lg:gap-8 lg:px-14">
        <div className="self-end lg:col-span-6">
          <h2 id="cta-heading" className="text-[13vw] font-semibold leading-[0.92] tracking-[-0.04em] sm:text-[64px] lg:text-[clamp(56px,7vw,108px)]">
            {title[0]}
            <br />
            {title[1]}
          </h2>
          <p className="mt-5 max-w-[40ch] text-[17px]">
            One account per person. Candidates, employers and colleges each get their own sign-in and their own space.
          </p>
        </div>

        <div className="lg:col-span-5 lg:col-start-8">
          <div data-ui className="rounded-[8px] bg-paper p-5 text-ink shadow-[0_24px_60px_-30px_rgba(12,23,48,0.6)] sm:p-6">
            <p className="text-[17px] font-semibold">Create your account</p>
            <p className="mt-1 text-[14px] text-muted">Who are you signing up as?</p>
            <div className="mt-4 grid grid-cols-3 gap-1 rounded-[6px] bg-surface p-1" role="radiogroup" aria-label="Account type">
              {OPTIONS.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  role="radio"
                  aria-checked={choice === i}
                  onClick={() => setChoice(i)}
                  className={`rounded-[4px] py-2 text-[14px] transition-colors ${choice === i ? "bg-paper font-semibold" : "text-muted hover:text-ink"}`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="mt-4 min-h-[44px] text-[14px] text-muted">{opt.next}</p>
            <Link
              href={`/signup/${opt.value}/`}
              className="mt-4 flex h-[52px] items-center justify-center rounded-[6px] bg-navy text-[15px] font-medium text-on-navy transition-colors hover:bg-navy-deep"
            >
              Continue as {opt.label.toLowerCase()}
            </Link>
            <p className="mt-3 text-center text-[14px] text-muted">
              Already have an account?{" "}
              <Link href={`/login/${opt.value}/`} className="font-medium text-navy hover:underline">
                Sign in
              </Link>
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
