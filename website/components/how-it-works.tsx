"use client";

import { useEffect, useRef, useState } from "react";

import { ApplicationTracker } from "@/components/fragments/application-tracker";
import { ResumeReview, ResumeUpload } from "@/components/fragments/resume-review";

const STEPS = [
  {
    title: "Start with your CV.",
    body: "Upload the one you have, or build one from four templates in a few minutes. Free, before you pay for anything.",
    fragment: <ResumeUpload />,
  },
  {
    title: "Then check what we read.",
    body: "Reading a CV is never perfect, so you see every line we took from it and fix it first. Only what you confirm is scored.",
    fragment: <ResumeReview />,
  },
  {
    title: "Apply, and watch it move.",
    body: "Each application shows its stage: viewed, shortlisted, interview, decision. You confirm a hire yourself.",
    fragment: <ApplicationTracker reached={3} />,
  },
];

/** The fragment stays pinned while the three statements scroll past and change it. */
export function HowItWorks() {
  const [active, setActive] = useState(0);
  const refs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.index));
        }
      },
      { rootMargin: "-45% 0px -45% 0px" },
    );
    refs.current.forEach((r) => r && io.observe(r));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="how-heading" className="mx-auto max-w-[1240px] px-4 py-16 sm:px-6 lg:px-10">
      <div className="grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-5">
          <h2 id="how-heading" className="text-[26px] font-semibold tracking-[-0.02em]">
            How it works for candidates
          </h2>
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              ref={(el) => {
                refs.current[i] = el;
              }}
              data-index={i}
              className="flex min-h-[38svh] flex-col justify-center lg:min-h-[70svh]"
            >
              <p className={`text-[24px] font-semibold leading-tight tracking-[-0.02em] transition-colors sm:text-[30px] ${active === i ? "text-ink" : "text-muted"}`}>
                {s.title}
              </p>
              <p className="mt-3 max-w-[42ch] text-muted">{s.body}</p>
              <div className="mt-6 lg:hidden">{s.fragment}</div>
            </div>
          ))}
        </div>
        <div className="hidden lg:col-span-7 lg:block">
          <div className="sticky top-[14vh] flex h-[72vh] items-center justify-center rounded-[6px] bg-navy p-10">
            <div key={active} className="fade-up w-full max-w-[440px]" style={{ animationDelay: "0ms" }}>
              {STEPS[active].fragment}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
