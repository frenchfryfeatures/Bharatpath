"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { ApplicationTracker } from "@/components/fragments/application-tracker";
import { CandidateCard } from "@/components/fragments/candidate-card";
import { CohortPanel } from "@/components/fragments/cohort-panel";

const ITEMS = [
  {
    key: "student",
    label: "I want a job",
    title: "Apply, then actually know where you stand.",
    body: "Every application shows its stage, from the moment you apply to the day you are hired. No more sending a CV into silence.",
    href: "/students/",
    cta: "For students and job seekers",
    fragment: <ApplicationTracker />,
  },
  {
    key: "employer",
    label: "I'm hiring",
    title: "Search by skill and city. Open only who you need.",
    body: "From a workshop hiring its first supervisor to a chain staffing forty stores, the same tools: post, search, shortlist, hire.",
    href: "/employers/",
    cta: "For employers and MSMEs",
    fragment: <CandidateCard />,
  },
  {
    key: "college",
    label: "I run placements",
    title: "Your whole cohort, from linked to hired.",
    body: "Invite students with a code, give them access through your seats, and follow where every batch is in the season.",
    href: "/colleges/",
    cta: "For colleges and institutions",
    fragment: <CohortPanel />,
  },
] as const;

/** Three doors on the left, the matching piece of the product on the right. */
export function AudienceShowcase() {
  const [active, setActive] = useState(0);
  const item = ITEMS[active];

  return (
    <section aria-labelledby="who-heading" className="mx-auto max-w-[1240px] px-4 py-24 sm:px-6 lg:px-10 lg:py-32">
      <h2 id="who-heading" className="sr-only">
        Who BharatPath is for
      </h2>
      <div className="grid gap-10 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-5">
          <div className="-mx-4 flex snap-x gap-6 overflow-x-auto px-4 scrollbar-thin lg:mx-0 lg:block lg:space-y-2 lg:overflow-visible lg:px-0" role="tablist" aria-label="Choose who you are">
            {ITEMS.map((it, i) => (
              <button
                key={it.key}
                type="button"
                role="tab"
                id={`tab-${it.key}`}
                aria-selected={active === i}
                aria-controls="audience-panel"
                onClick={() => setActive(i)}
                className={`block shrink-0 snap-start text-left text-[24px] font-semibold leading-[1.1] tracking-[-0.03em] transition-colors sm:text-[34px] lg:text-[clamp(36px,4vw,60px)] ${
                  active === i ? "text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {it.label}
              </button>
            ))}
          </div>
          <div key={item.key} className="mt-8 max-w-[44ch] lg:mt-14">
            <p className="text-[20px] font-medium leading-snug tracking-[-0.01em]">{item.title}</p>
            <p className="mt-3 text-muted">{item.body}</p>
            <Link href={item.href} className="mt-6 inline-flex items-center gap-2 font-medium text-navy hover:underline">
              {item.cta}
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          </div>
        </div>

        <div
          id="audience-panel"
          role="tabpanel"
          aria-labelledby={`tab-${item.key}`}
          className="relative flex min-h-[460px] items-start overflow-hidden rounded-[6px] bg-surface p-4 pt-10 sm:p-10 sm:pt-16 lg:col-span-7 lg:min-h-[560px]"
        >
          <div key={item.key} className="fade-up w-full" style={{ animationDelay: "0ms" }}>
            {item.fragment}
          </div>
        </div>
      </div>
    </section>
  );
}
